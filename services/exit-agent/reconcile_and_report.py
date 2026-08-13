#!/usr/bin/env python3
"""Reconcile an xray exit's client roster and report per-account usage.

Two jobs on one timer, because they share the same roster:

  1. The exit accepts exactly the accounts the control plane says it should. The
     roster excludes accounts that are inactive, expired, or past quota, so
     reconciling *removes* them — and removal is what stops traffic. Enforcement
     that only stops counting stops nothing.

  2. Per-account counters are read and reported. `enforceAll` has always been
     ready to act on usage; the number simply never arrived, because every
     account used to present the same identity and the exit could not say whose
     bytes were whose.

Contract notes that are easy to get wrong:

  * `totalBytes` is a **monotonic lifetime total per account**, not a delta. The
    server stores immutable rows and takes MAX, so a counter that moves backwards
    is a bug to refuse rather than to smooth over.
  * xray's counters reset when it restarts, so lifetime totals live here, on disk,
    and restarts contribute deltas. Without that, every restart would silently
    forgive whatever an account had used.
  * A batch accepted by the server but not acknowledged locally is replayed. Rows
    are idempotent by `reportId`, so replaying is safe and losing the
    acknowledgement is not.

Nothing here guesses at xray's management interface. The subcommands differ
between versions, so this asks the binary what it supports and refuses with the
observed list when it cannot find what it needs. A silent no-op would look like a
working meter reporting zero.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

MAX_REPORTS_PER_REQUEST = 500
MAX_USERS_PER_REQUEST = 100
MAX_SAFE_INTEGER = (1 << 53) - 1
MAX_RESPONSE_BYTES = 512 * 1024
STATE_MODE = 0o600
# Label written by enable-tono-exit-metering.sh for the credential every
# current client still holds. Removing it would drop the fleet.
LEGACY_CLIENT_EMAIL = "shared-legacy"
REQUEST_HEADERS = {
    "accept": "application/json",
    # Zone browser-integrity rejects a bare urllib UA with CF 403/1010.
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) tono-exit-agent/1.0",
}


class Refusal(RuntimeError):
    """A condition the operator must fix. Never worked around silently."""


def env(name: str, *, required: bool = True) -> str:
    value = os.environ.get(name, "").strip()
    if not value and required:
        raise Refusal(f"{name} must be set")
    return value


def api_base() -> str:
    base = env("TONO_API_BASE").rstrip("/")
    if not base.startswith("https://"):
        raise Refusal("TONO_API_BASE must be an https URL")
    return base


def xray_binary() -> Path:
    path = Path(env("TONO_XRAY_BINARY", required=False) or "/opt/tono-xray/current/xray")
    if not path.is_file() or not os.access(path, os.X_OK):
        raise Refusal(f"xray binary not found or not executable at {path}")
    return path


def api_address() -> str:
    # The management inbound. Localhost-only by design: this is the interface that
    # can add and remove accounts.
    return env("TONO_XRAY_API_ADDRESS", required=False) or "127.0.0.1:10085"


def inbound_tag() -> str:
    return env("TONO_XRAY_INBOUND_TAG", required=False) or "tono-vless"


def state_path() -> Path:
    return Path(env("TONO_AGENT_STATE", required=False) or "/var/lib/tono-exit-agent/state.json")


def run_xray(binary: Path, arguments: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(binary), *arguments],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def supported_api_commands(binary: Path) -> set[str]:
    """What this xray's `api` subcommand actually offers.

    Version-dependent, so it is discovered rather than assumed. The alternative —
    hardcoding a guess — fails by doing nothing, which is indistinguishable from
    an exit with no accounts on it.
    """
    result = run_xray(binary, ["api"])
    text = f"{result.stdout}\n{result.stderr}"
    # Help is tab-indented on current Xray builds (`\tadu  Add users…`).
    # Requiring two spaces missed every command except accidental matches.
    return set(re.findall(r"^\s+([a-z][a-z0-9]+)\s+", text, re.MULTILINE))


def require_commands(binary: Path) -> dict[str, str]:
    available = supported_api_commands(binary)
    # Names seen across versions, most specific first. Whichever exists is used.
    wanted = {
        "add_user": ("adu", "adduser", "adi"),
        "remove_user": ("rmu", "removeuser"),
        "stats_query": ("statsquery", "stats"),
    }
    resolved: dict[str, str] = {}
    missing: list[str] = []
    for role, candidates in wanted.items():
        for candidate in candidates:
            if candidate in available:
                resolved[role] = candidate
                break
        else:
            missing.append(f"{role} (tried {', '.join(candidates)})")
    if missing:
        raise Refusal(
            "this xray's api subcommands do not cover "
            + "; ".join(missing)
            + f". It offers: {', '.join(sorted(available)) or '(nothing parseable)'}. "
            "Reconciling and metering both need the management API; fix the build "
            "or the config rather than letting this run as a no-op."
        )
    return resolved


def fetch_roster(base: str, token: str) -> tuple[int, list[dict[str, str]]]:
    request = urllib.request.Request(
        f"{base}/api/v1/home/exit-identities",
        headers={"authorization": f"Bearer {token}", **REQUEST_HEADERS},
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.loads(response.read(MAX_RESPONSE_BYTES).decode("utf-8"))
    observed_at = payload.get("observedAt")
    identities = payload.get("identities")
    if not isinstance(observed_at, int) or not isinstance(identities, list):
        raise Refusal("roster response is not the documented shape")
    roster: list[dict[str, str]] = []
    for entry in identities:
        if not isinstance(entry, dict):
            raise Refusal("roster entry is not an object")
        user_id = entry.get("userId")
        client_uuid = entry.get("clientUUID")
        if not isinstance(user_id, str) or not 1 <= len(user_id) <= 100:
            raise Refusal("roster entry has an invalid userId")
        if not isinstance(client_uuid, str) or not re.fullmatch(
            r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", client_uuid
        ):
            raise Refusal("roster entry has an invalid clientUUID")
        roster.append({"userId": user_id, "clientUUID": client_uuid})
    if len({entry["clientUUID"] for entry in roster}) != len(roster):
        raise Refusal("roster repeats an identity, which would merge two accounts' counters")
    return observed_at, roster


def load_state(path: Path) -> dict:
    if not path.exists():
        return {"totals": {}, "counterBaseline": {}, "pendingReports": []}
    with path.open("r", encoding="utf-8") as handle:
        state = json.load(handle)
    for key, kind in (("totals", dict), ("counterBaseline", dict), ("pendingReports", list)):
        if not isinstance(state.get(key), kind):
            raise Refusal(f"state file is corrupt: {key}")
    return state


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".new")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(state, handle, sort_keys=True)
    os.chmod(temporary, STATE_MODE)
    # Rename rather than write in place: a crash mid-write would otherwise leave
    # lifetime totals truncated, and truncated totals bill nobody for what they
    # already used.
    temporary.replace(path)


def read_counters(binary: Path, command: str, address: str) -> dict[str, int]:
    """Per-account uplink+downlink, keyed by the account label."""
    result = run_xray(binary, ["api", command, f"--server={address}", "--reset=false"])
    if result.returncode != 0:
        raise Refusal(f"reading counters failed: {result.stderr.strip() or result.returncode}")
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError as error:
        raise Refusal(f"counter output was not JSON: {error}") from error
    counters: dict[str, int] = {}
    for stat in payload.get("stat", []) or []:
        name = stat.get("name")
        if not isinstance(name, str):
            continue
        match = re.fullmatch(r"user>>>(.+?)>>>traffic>>>(uplink|downlink)", name)
        if not match:
            continue
        value = stat.get("value", 0)
        value = int(value) if isinstance(value, (int, str)) and str(value).isdigit() else 0
        counters[match.group(1)] = counters.get(match.group(1), 0) + value
    return counters


def reconcile(binary: Path, commands: dict[str, str], address: str, tag: str,
              roster: list[dict[str, str]], counters: dict[str, int]) -> tuple[int, int]:
    """Add accounts the roster names, remove accounts it does not.

    The account label is its userId, because the label is the only thing counters
    are keyed by — a label that is not the account identifier makes usage
    unattributable, which is the entire fault being repaired.
    """
    wanted = {entry["userId"]: entry["clientUUID"] for entry in roster}
    present = set(counters)
    # An empty roster is the common case until accounts have fetched a
    # placeholder catalog. Treating it as "remove everyone" would delete the
    # shared-legacy client and disconnect the fleet.
    if not wanted:
        return 0, 0
    added = 0
    for user_id, client_uuid in wanted.items():
        if user_id in present:
            continue
        result = run_xray(binary, [
            "api", commands["add_user"], f"--server={address}",
            f"--tag={tag}", f"--email={user_id}", f"--uuid={client_uuid}",
        ])
        # Already-present is success, not failure: two agents on one timer, or a
        # retry after a lost response, must not turn into an error loop.
        if result.returncode != 0 and "already exists" not in (result.stderr or "").lower():
            raise Refusal(f"adding {user_id} failed: {result.stderr.strip() or result.returncode}")
        added += 1
    removed = 0
    for user_id in sorted(present - set(wanted)):
        if user_id == LEGACY_CLIENT_EMAIL:
            continue
        result = run_xray(binary, [
            "api", commands["remove_user"], f"--server={address}",
            f"--tag={tag}", f"--email={user_id}",
        ])
        if result.returncode != 0 and "not found" not in (result.stderr or "").lower():
            raise Refusal(f"removing {user_id} failed: {result.stderr.strip() or result.returncode}")
        removed += 1
    return added, removed


def lifetime_totals(state: dict, counters: dict[str, int]) -> dict[str, int]:
    """Fold restart-resetting counters into monotonic lifetime totals."""
    totals: dict[str, int] = {}
    baseline: dict[str, int] = {}
    for user_id, observed in counters.items():
        previous_raw = int(state["counterBaseline"].get(user_id, 0))
        carried = int(state["totals"].get(user_id, 0))
        # A counter below its last raw reading means xray restarted, so the whole
        # of the new reading is fresh usage rather than a decrease.
        delta = observed - previous_raw if observed >= previous_raw else observed
        total = carried + delta
        if total > MAX_SAFE_INTEGER:
            raise Refusal(f"lifetime total for {user_id} exceeds the reportable range")
        totals[user_id] = total
        baseline[user_id] = observed
    # Accounts absent from this reading keep whatever they had: removal from the
    # roster must not roll a total backwards.
    for user_id, carried in state["totals"].items():
        totals.setdefault(user_id, int(carried))
        baseline.setdefault(user_id, int(state["counterBaseline"].get(user_id, 0)))
    state["counterBaseline"] = baseline
    return totals


def deliver(base: str, token: str, reports: list[dict]) -> None:
    body = json.dumps({"reports": reports}).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/api/v1/home/usage",
        data=body,
        headers={
            "authorization": f"Bearer {token}",
            "content-type": "application/json",
            **REQUEST_HEADERS,
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response.read(MAX_RESPONSE_BYTES)


def main() -> None:
    base = api_base()
    token = env("TONO_HOME_AGENT_TOKEN")
    binary = xray_binary()
    address = api_address()
    tag = inbound_tag()
    path = state_path()
    state = load_state(path)
    commands = require_commands(binary)

    # A batch the server accepted but that was never acknowledged here is replayed
    # before anything else, because reports are idempotent by reportId and a lost
    # acknowledgement must not become lost usage.
    pending = [
        report for report in state["pendingReports"]
        if isinstance(report, dict) and report.get("userId") != LEGACY_CLIENT_EMAIL
    ]
    if pending:
        deliver(base, token, pending)
        print("replayed a pending usage batch")
    if state["pendingReports"]:
        state["pendingReports"] = []
        save_state(path, state)

    observed_at, roster = fetch_roster(base, token)
    counters = read_counters(binary, commands["stats_query"], address)
    added, removed = reconcile(binary, commands, address, tag, roster, counters)
    if added or removed:
        # Re-read after changing the roster so a freshly added account is counted
        # from its own baseline rather than from whatever it had before.
        counters = read_counters(binary, commands["stats_query"], address)
    print(f"roster observed at {observed_at}: +{added} -{removed}, {len(counters)} counted")

    totals = lifetime_totals(state, counters)
    timestamp = int(time.time())
    reports: list[dict] = []
    for user_id in sorted(totals):
        if user_id == LEGACY_CLIENT_EMAIL:
            continue
        total = totals[user_id]
        previous = int(state["totals"].get(user_id, 0))
        if total < previous:
            raise Refusal(f"total for {user_id} moved backwards, which is never correct")
        if total > previous:
            reports.append({
                "reportId": str(uuid.uuid4()),
                "userId": user_id,
                "totalBytes": total,
                "observedAt": timestamp,
            })
    state["totals"] = {user_id: int(value) for user_id, value in totals.items()}

    if not reports:
        save_state(path, state)
        print("no new usage to report")
        return
    if len(reports) > MAX_REPORTS_PER_REQUEST or len(reports) > MAX_USERS_PER_REQUEST:
        # Bounded by the server, so bounded here rather than discovered as a 400.
        raise Refusal(
            f"{len(reports)} reports exceeds the per-request limit; batch across runs"
        )

    # Persist before delivering: a crash after the server accepts must replay, and
    # replaying is safe. The reverse — delivering first — loses usage silently.
    state["pendingReports"] = reports
    save_state(path, state)
    deliver(base, token, reports)
    state["pendingReports"] = []
    save_state(path, state)
    print(f"reported usage for {len(reports)} accounts")


if __name__ == "__main__":
    try:
        main()
    except Refusal as refusal:
        print(f"refusing: {refusal}", file=sys.stderr)
        raise SystemExit(1)
    except urllib.error.HTTPError as error:
        print(f"control plane returned {error.code}: {error.reason}", file=sys.stderr)
        raise SystemExit(1)
