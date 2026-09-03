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

  * `totalBytes` is a **monotonic lifetime total per account**, not a delta, and
    it covers this exit alone. Every report names its `sourceId`, and the server
    keeps one cumulative figure per (account, source) and *adds* them: an account
    spread over three exits is the sum of three counters rather than the largest
    of them. That holds only while the source name is stable across runs, so it
    is taken from the machine's own identity and then kept on disk.
  * xray's counters reset when it restarts, so lifetime totals live here, on disk,
    and restarts contribute deltas. Without that, every restart would silently
    forgive whatever an account had used. The restart itself is read off the node
    — the boot id and the process' own start tick — rather than inferred from a
    counter that fell, because a busy account can pass its pre-restart figure
    before the next run and a counter that rose looks exactly like growth.
  * Delivery is queued, bounded and retried. Progress is recorded per request, so
    a round that fails halfway keeps what it delivered; the queue holds one entry
    per account and source, because a cumulative figure supersedes the one before
    it. An outage therefore costs no accuracy and cannot grow the queue forever.
  * Client labels are namespaced `u:`, which is the form the control plane issues
    and the fleet audit counts. Removal is driven from what the exit is known to
    hold and never from the counters: a counter appears on first connect and
    outlives the client it belonged to, so removing on that basis revokes live
    accounts.

Nothing here guesses at xray's management interface. The subcommands differ
between versions, so this asks the binary what it supports and refuses with the
observed list when it cannot find what it needs. A silent no-op would look like a
working meter reporting zero.
"""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

MAX_REPORTS_PER_REQUEST = 500
MAX_USERS_PER_REQUEST = 100
# What one request carries. The queue holds a single entry per account and
# source, so the report limit and the distinct-user limit are the same limit.
BATCH_SIZE = min(MAX_REPORTS_PER_REQUEST, MAX_USERS_PER_REQUEST)
DELIVERY_ATTEMPTS = 4
DELIVERY_BACKOFF_SECONDS = 3
# Worth another attempt.
RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
# The batch itself is what is wrong, so offering it again changes nothing and
# the accounts queued behind it must not wait for it. Anything else — a rejected
# token, a wrong base URL — is the operator's to fix and keeps the queue intact.
REJECTED_STATUSES = frozenset({400, 409, 413, 422})
MAX_SAFE_INTEGER = (1 << 53) - 1
MAX_RESPONSE_BYTES = 512 * 1024
STATE_MODE = 0o600
# Label written by enable-tono-exit-metering.sh for the credential every
# current client still holds. Removing it would drop the fleet.
LEGACY_CLIENT_EMAIL = "shared-legacy"
# The control plane hands out `u:<userId>` as the client label and the fleet
# audit counts labels in that form. Writing anything else makes the three
# disagree about what an exit holds.
CLIENT_LABEL_PREFIX = "u:"
SOURCE_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,64}")
REQUEST_HEADERS = {
    "accept": "application/json",
    # Zone browser-integrity rejects a bare urllib UA with CF 403/1010.
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) tono-exit-agent/1.0",
}


class Refusal(RuntimeError):
    """A condition the operator must fix. Never worked around silently."""


class Rejection(RuntimeError):
    """A batch the control plane refused. Offering it again changes nothing."""


class Unreachable(RuntimeError):
    """Delivery did not get through. The queue keeps it for the next run."""


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


def machine_identity() -> str:
    """Something already on this box that outlives the agent and its state.

    The hostname leads, because nodes are provisioned from cloned images and a
    clone carries the source image's `/etc/machine-id`. Two exits presenting one
    name do not merely merge — each reads the other's lower figure as a counter
    reset and the account's total runs away — so the part that is set per node is
    the part that must survive the length limit.
    """
    hostname = socket.gethostname().strip()
    for candidate in (Path("/etc/machine-id"), Path("/var/lib/dbus/machine-id")):
        try:
            value = candidate.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if value:
            return f"{hostname}-{value}" if hostname else value
    return hostname


def source_id(state: dict) -> str:
    """The name this exit's counters are added up under.

    The server keeps one cumulative figure per (account, source), so two exits
    must never present the same name — their counters would read as each other's
    resets — and one exit must present the same name every run, or its usage
    starts again from zero under a second name. So it comes from the machine's
    own identity rather than being generated per run.

    A name that does change is treated as a move rather than as history to
    re-report: the figures already sent stay where they are and this exit counts
    from here, because sending its lifetime total again under a new name would
    bill the account for the same bytes twice.
    """
    configured = env("TONO_EXIT_SOURCE_ID", required=False) or machine_identity()
    normalized = re.sub(r"[^A-Za-z0-9._-]", "-", configured).strip("-")
    # Preserve both halves of a long default identity. Left-truncating at 64
    # characters can discard the machine-id entirely, so two exits with the same
    # long hostname present one source and read each other's lower cumulative
    # figures as counter resets. A readable prefix plus a digest of the complete
    # input stays stable and keeps those nodes distinct.
    if len(normalized) > 64:
        digest = hashlib.sha256(configured.encode("utf-8")).hexdigest()[:32]
        normalized = f"{normalized[:31].rstrip('-')}-{digest}"
    source = normalized
    if not SOURCE_ID_PATTERN.fullmatch(source):
        raise Refusal(
            "this exit has no stable identity to report under; set TONO_EXIT_SOURCE_ID"
        )
    recorded = state.get("sourceId")
    if isinstance(recorded, str) and recorded and recorded != source:
        state["totals"] = {label: 0 for label in state["totals"]}
        print(f"source id changed from {recorded} to {source}; counting from here")
    state["sourceId"] = source
    return source


def client_label(user_id: str, device_id: str | None = None) -> str:
    """The label an account's client is installed under, and counted under."""
    if device_id:
        return f"{CLIENT_LABEL_PREFIX}{user_id}:{device_id}"
    return f"{CLIENT_LABEL_PREFIX}{user_id}"


def attributed_user(label: str) -> str | None:
    """The account a counter belongs to, or None when the label is not ours.

    `shared-legacy` and anything added by hand carry traffic that belongs to no
    single account; reporting it against one would bill the wrong customer.
    Supports device-scoped labels: `u:<user_id>:<device_id>`.
    """
    if not label.startswith(CLIENT_LABEL_PREFIX):
        return None
    raw = label[len(CLIENT_LABEL_PREFIX):]
    return raw.split(":")[0] or None


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
    # Listing the inbound's clients is what makes a removal safe, and older
    # builds do not have it — so it is looked up and lived without rather than
    # required, and its absence makes this agent remove nothing.
    optional = {"list_users": ("inbounduser", "iu")}
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
    for role, candidates in optional.items():
        for candidate in candidates:
            if candidate in available:
                resolved[role] = candidate
                break
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
        device_id = entry.get("deviceId")
        if device_id is not None and (not isinstance(device_id, str) or not 1 <= len(device_id) <= 100):
            device_id = None
        roster.append({"userId": user_id, "clientUUID": client_uuid, "deviceId": device_id})
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
    # Absent on a state file written before this agent recorded them, which is
    # not corruption — it is the case that has to remove nothing.
    for key, kind in (("installedClients", list), ("sourceId", str), ("startMarker", str)):
        if key in state and not isinstance(state[key], kind):
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


@contextmanager
def agent_run_lock(path: Path):
    """Hold one lock across roster mutation, counter folding, and delivery.

    A systemd timer and an operator-started run can otherwise both read the same
    state and then overwrite each other's baselines and pending queue. The fixed
    `.new` path also makes concurrent saves race at rename time. Skipping the
    overlapping run is safe because every counter and report is cumulative.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(f"{path.name}.lock")
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    descriptor = os.open(lock_path, flags, STATE_MODE)
    handle = os.fdopen(descriptor, "r+")
    try:
        os.fchmod(handle.fileno(), STATE_MODE)
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise Refusal("another exit-agent run is still active") from error
        yield
    finally:
        handle.close()


def xray_start_marker(binary: Path, proc: Path = Path("/proc")) -> str | None:
    """A node-level mark that changes exactly when the xray process comes up again.

    A restart is otherwise inferred from the counter going backwards, and that
    cannot see a restart whose first reading lands at or above the last one — a
    busy account passes its old figure between two runs and the difference is
    quietly forgiven. The boot id and the process' own start tick are not a
    measurement of usage at all, so one observation settles every account.

    Nothing here asks xray anything: the subcommands differ between versions, and
    a meter must not depend on one that may not be there. Anything unreadable, or
    more than one candidate process, is *not* a restart — the marker is absent and
    the fold falls back to comparing counters, which is the conservative direction.
    """
    try:
        boot_id = (proc / "sys/kernel/random/boot_id").read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not boot_id:
        return None
    resolved = binary.resolve()
    starts: list[str] = []
    try:
        entries = sorted(proc.iterdir())
    except OSError:
        return None
    for entry in entries:
        if not entry.name.isdigit():
            continue
        # `exe` resolves the versioned binary behind the `current` symlink and is
        # the accurate answer; `cmdline` is what is left when it cannot be read.
        try:
            executable = Path(os.readlink(entry / "exe"))
        except OSError:
            try:
                first = (entry / "cmdline").read_bytes().split(b"\0")[0]
            except OSError:
                continue
            if not first:
                continue
            executable = Path(first.decode("utf-8", "replace"))
        if executable != binary and executable.resolve() != resolved:
            continue
        try:
            stat = (entry / "stat").read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        # `comm` is parenthesised and may itself contain spaces, so the fields are
        # counted from after the closing parenthesis: starttime is the 22nd field
        # overall, which is the 20th of those.
        fields = stat.rpartition(")")[2].split()
        if len(fields) < 20:
            continue
        starts.append(fields[19])
    if len(starts) != 1:
        return None
    # The tick count is per boot, so it is only meaningful alongside the boot it
    # was counted in — a reboot restarts both.
    return f"{boot_id}:{starts[0]}"


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


def installed_clients(binary: Path, commands: dict[str, str], address: str,
                      tag: str) -> set[str] | None:
    """The labels the inbound holds, or None when this xray cannot be asked.

    Counters cannot stand in for this. A counter is created on first connect and
    outlives the client it belonged to, so it lists accounts that are long gone
    and omits ones installed a moment ago — driving removal from it revokes live
    customers and re-adds duplicates of the rest.
    """
    command = commands.get("list_users")
    if not command:
        return None
    result = run_xray(binary, ["api", command, f"--server={address}", f"--tag={tag}"])
    if result.returncode != 0:
        return None
    try:
        payload = json.loads(result.stdout or "{}")
    except json.JSONDecodeError:
        return None
    entries = payload.get("users") if isinstance(payload, dict) else None
    if entries is None and isinstance(payload, dict):
        entries = payload.get("user", [])
    if not isinstance(entries, list):
        return None
    labels: set[str] = set()
    for entry in entries:
        # A shape this cannot read is unknown, not empty: an unknown listing
        # removes nothing, an empty one would remove everything.
        if not isinstance(entry, dict):
            return None
        label = entry.get("email")
        if not isinstance(label, str) or not label:
            return None
        labels.add(label)
    return labels


def reconcile(binary: Path, commands: dict[str, str], address: str, tag: str,
              roster: list[dict[str, str]], listed: set[str] | None,
              recorded: set[str] | None) -> tuple[int, int, set[str] | None]:
    """Add the accounts the roster names, remove the ones it does not.

    `listed` is what the inbound actually holds and `recorded` is what this agent
    remembers installing. Clients added over the management API never reach
    config.json, so a restart drops all of them: adds are attempted whenever the
    node cannot be asked, which is cheap because an account already present is
    success.

    Removal is the enforcement path, and a wrong one disconnects a paying
    customer. So it runs off what the node holds, or failing that off the labels
    this agent recorded installing, and never off counters. When neither is
    known, nothing is removed.
    """
    wanted = {client_label(entry["userId"], entry.get("deviceId")): entry["clientUUID"] for entry in roster}
    # A verified empty roster is the enforcement result after the final active
    # account expires, is disabled, or reaches quota. It must remove this
    # agent's `u:` clients or those accounts keep connecting forever. When both
    # the live listing and our durable record are unknown, retain the original
    # fail-safe and remove nothing; the shared legacy identity is outside the
    # namespace in either case.
    if not wanted and listed is None and recorded is None:
        return 0, 0, None
    added = 0
    for label, client_uuid in sorted(wanted.items()):
        if listed is not None and label in listed:
            continue
        result = run_xray(binary, [
            "api", commands["add_user"], f"--server={address}",
            f"--tag={tag}", f"--email={label}", f"--uuid={client_uuid}",
        ])
        # Already-present is success, not failure: two agents on one timer, or a
        # retry after a lost response, must not turn into an error loop. It is
        # not an addition either, or every round would report the whole roster.
        if result.returncode != 0 and "already exists" not in (result.stderr or "").lower():
            raise Refusal(f"adding {label} failed: {result.stderr.strip() or result.returncode}")
        if result.returncode == 0:
            added += 1
    installed = listed if listed is not None else recorded
    removed = 0
    if installed is None:
        print("this exit cannot say which clients it holds; removed nothing")
    else:
        for label in sorted(installed - set(wanted)):
            # Only this agent's own namespace is a candidate. `shared-legacy` and
            # hand-added entries belong to somebody else, and the counters that
            # used to drive this listed both of them.
            if not label.startswith(CLIENT_LABEL_PREFIX):
                continue
            result = run_xray(binary, [
                "api", commands["remove_user"], f"--server={address}",
                f"--tag={tag}", f"--email={label}",
            ])
            if result.returncode != 0 and "not found" not in (result.stderr or "").lower():
                raise Refusal(f"removing {label} failed: {result.stderr.strip() or result.returncode}")
            removed += 1
    return added, removed, set(wanted)


def lifetime_totals(state: dict, counters: dict[str, int], *,
                    restarted: bool = False) -> dict[str, int]:
    """Fold restart-resetting counters into monotonic lifetime totals.

    `restarted` is the node saying xray came up again since the last reading. It
    is out of band from the numbers, so it settles every account at once —
    including the ones whose first reading after the restart landed at or above
    the last one, which a counter comparison reads as growth and forgives the
    difference for. Absent that signal the comparison is all there is.
    """
    totals: dict[str, int] = {}
    baseline: dict[str, int] = {}
    for label, observed in counters.items():
        previous_raw = int(state["counterBaseline"].get(label, 0))
        carried = int(state["totals"].get(label, 0))
        # After a restart the whole of the new reading is fresh usage rather than
        # a decrease; a counter below its last raw reading says so on its own.
        delta = observed if restarted or observed < previous_raw else observed - previous_raw
        total = carried + delta
        if total > MAX_SAFE_INTEGER:
            raise Refusal(f"lifetime total for {label} exceeds the reportable range")
        totals[label] = total
        baseline[label] = observed
    # Accounts absent from this reading keep whatever they had: removal from the
    # roster must not roll a total backwards.
    for label, carried in state["totals"].items():
        totals.setdefault(label, int(carried))
        baseline.setdefault(label, int(state["counterBaseline"].get(label, 0)))
    state["counterBaseline"] = baseline
    return totals


def merge_reports(queued: list, fresh: list[dict]) -> list[dict]:
    """One entry per account and source, keeping the newest cumulative figure.

    Bounds the queue by how many accounts there are rather than by how long a
    delivery outage lasted, and costs nothing: the server keeps the latest
    cumulative figure per source, so a superseded one carries no information the
    newer one does not.
    """
    latest: dict[tuple[str, str], dict] = {}
    for report in [*queued, *fresh]:
        if not isinstance(report, dict):
            continue
        user_id = report.get("userId")
        total = report.get("totalBytes")
        if not isinstance(user_id, str) or not isinstance(total, int):
            continue
        # Traffic on the shared credential belongs to no single account.
        if user_id == LEGACY_CLIENT_EMAIL:
            continue
        key = (str(report.get("sourceId", "")), user_id)
        previous = latest.get(key)
        if previous is None or int(previous["totalBytes"]) <= total:
            latest[key] = report
    return [latest[key] for key in sorted(latest)]


def deliver(base: str, token: str, reports: list[dict]) -> None:
    """One request, retried while the failure could still be a passing one."""
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
    for attempt in range(1, DELIVERY_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response.read(MAX_RESPONSE_BYTES)
            return
        except urllib.error.HTTPError as error:
            if error.code in REJECTED_STATUSES:
                raise Rejection(f"{error.code} {error.reason}") from error
            if error.code not in RETRYABLE_STATUSES:
                raise Refusal(
                    f"the control plane answered {error.code} {error.reason}; "
                    "the measured usage stays queued"
                ) from error
            failure = f"{error.code} {error.reason}"
        except OSError as error:
            failure = str(error)
        if attempt == DELIVERY_ATTEMPTS:
            raise Unreachable(f"{DELIVERY_ATTEMPTS} attempts failed: {failure}")
        time.sleep(DELIVERY_BACKOFF_SECONDS * attempt)


def deliver_queue(base: str, token: str, path: Path, state: dict) -> tuple[int, int]:
    """Send the queue in bounded requests, recording progress after each one.

    Progress is per request rather than per round: one failure used to discard
    everything measured that round, and a batch larger than the server's limit
    was never offered at all, which stopped the meter until an operator noticed.

    A batch refused outright is halved until the single report being objected to
    is isolated, and that one is dropped rather than left to block every account
    behind it. Nothing is lost by dropping it: the figure is cumulative, so this
    account's next report carries those bytes again.
    """
    delivered = 0
    dropped = 0
    size = BATCH_SIZE
    while state["pendingReports"]:
        batch = state["pendingReports"][:size]
        try:
            deliver(base, token, batch)
        except Rejection as rejection:
            if len(batch) > 1:
                size = len(batch) // 2
                continue
            print(f"dropping a report the control plane refused ({rejection})", file=sys.stderr)
            dropped += 1
        else:
            delivered += len(batch)
        state["pendingReports"] = state["pendingReports"][len(batch):]
        save_state(path, state)
        size = BATCH_SIZE
    return delivered, dropped


def reconcile_and_read_stable(
    binary: Path,
    commands: dict[str, str],
    address: str,
    tag: str,
    roster: list[dict[str, str]],
    recorded: set[str] | None,
) -> tuple[int, int, set[str] | None, dict[str, int], str | None]:
    """Reconcile and read counters from one Xray process generation.

    A restart after the first marker can drop every API-installed client and
    reset every counter. Comparing only the new reading with the old baseline is
    insufficient when a busy account's new counter has already climbed above
    that baseline: it looks like a small increase and silently forgives the
    bytes before it. Retry the whole mutation/read once against the new process;
    a node that keeps restarting is unknown rather than billable guesswork.
    """
    for attempt in range(2):
        marker_before = xray_start_marker(binary)
        listed = installed_clients(binary, commands, address, tag)
        added, removed, installed = reconcile(
            binary, commands, address, tag, roster, listed, recorded,
        )
        counters = read_counters(binary, commands["stats_query"], address)
        marker_after = xray_start_marker(binary)
        if marker_before and marker_after and marker_before != marker_after:
            if attempt == 0:
                print("xray restarted during reconciliation; retrying against the new process")
                continue
            raise Refusal("xray kept restarting while clients and counters were reconciled")
        # The marker after the counter read is the only one known to still
        # describe that reading. If it is unavailable, forget the old marker so
        # a later process is not compared with stale evidence and folded twice.
        return added, removed, installed, counters, marker_after
    raise AssertionError("bounded xray reconciliation loop did not return")


def run_once(path: Path) -> None:
    base = api_base()
    token = env("TONO_HOME_AGENT_TOKEN")
    binary = xray_binary()
    address = api_address()
    tag = inbound_tag()
    state = load_state(path)
    source = source_id(state)
    commands = require_commands(binary)

    # A batch the server accepted but that was never acknowledged here goes out
    # before anything else: the figure is cumulative per source, so re-sending it
    # counts nothing twice, and losing the acknowledgement must not lose usage.
    if state["pendingReports"]:
        state["pendingReports"] = merge_reports(state["pendingReports"], [])
        save_state(path, state)
        replayed, discarded = deliver_queue(base, token, path, state)
        print(f"replayed {replayed} queued report(s), dropped {discarded}")

    observed_at, roster = fetch_roster(base, token)
    remembered = state.get("installedClients")
    added, removed, installed, counters, settled_marker = reconcile_and_read_stable(
        binary, commands, address, tag, roster,
        set(remembered) if isinstance(remembered, list) else None,
    )
    if installed is not None:
        state["installedClients"] = sorted(installed)
    recorded_marker = state.get("startMarker")
    restarted = bool(
        settled_marker
        and isinstance(recorded_marker, str)
        and recorded_marker
        and settled_marker != recorded_marker
    )
    print(
        f"roster observed at {observed_at}: +{added} -{removed}, {len(counters)} counted"
        + (", after an xray restart" if restarted else "")
    )

    totals = lifetime_totals(state, counters, restarted=restarted)
    timestamp = int(time.time())
    reports: list[dict] = []
    for label in sorted(totals):
        user_id = attributed_user(label)
        if user_id is None:
            continue
        total = totals[label]
        previous = int(state["totals"].get(label, 0))
        if total < previous:
            raise Refusal(f"total for {label} moved backwards, which is never correct")
        if total > previous:
            reports.append({
                "reportId": str(uuid.uuid4()),
                "userId": user_id,
                "sourceId": source,
                "totalBytes": total,
                "observedAt": timestamp,
            })
    state["totals"] = {label: int(value) for label, value in totals.items()}
    # A marker that could not be read this round is forgotten rather than kept:
    # comparing a later reading against a stale one would call a restart that had
    # already been folded in a second time, and bill it twice.
    if settled_marker:
        state["startMarker"] = settled_marker
    else:
        state.pop("startMarker", None)
    state["pendingReports"] = merge_reports(state["pendingReports"], reports)

    # Persist before delivering: a crash after the server accepts must replay, and
    # replaying is safe. The reverse — delivering first — loses usage silently.
    save_state(path, state)
    if not state["pendingReports"]:
        print("no new usage to report")
        return
    delivered, dropped = deliver_queue(base, token, path, state)
    print(f"reported usage for {delivered} accounts as {source}, dropped {dropped}")


def main() -> None:
    path = state_path()
    with agent_run_lock(path):
        run_once(path)


if __name__ == "__main__":
    try:
        main()
    except Refusal as refusal:
        print(f"refusing: {refusal}", file=sys.stderr)
        raise SystemExit(1)
    except Unreachable as unreachable:
        # Measured and queued, just not delivered. The next run carries it.
        print(f"usage not delivered: {unreachable}", file=sys.stderr)
        raise SystemExit(1)
    except urllib.error.HTTPError as error:
        print(f"control plane returned {error.code}: {error.reason}", file=sys.stderr)
        raise SystemExit(1)
