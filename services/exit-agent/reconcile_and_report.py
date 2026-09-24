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
    of them. `TONO_SOURCE_ID` must name the same exit node the control plane
    provisioned; the machine identity is only the fallback when it is unset.
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
import argparse
import errno
import fcntl
import hashlib
import http.client
import json
import os
import re
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
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
# How long the last verified roster may stand in for an unreachable control
# plane. Past this the node restores nothing: a day-old list is too likely to
# name accounts that have since been revoked, expired or run out of quota.
ROSTER_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60
ROSTER_CACHE_VERSION = 1
HY2_AUTH_ALLOWLIST = Path("/opt/tono-hy2/auth-allow.sha256")
HY2_ROSTER_MARKER = "# tono-exit-agent roster v1"
# Label written by enable-tono-exit-metering.sh for the credential every
# current client still holds. Removing it would drop the fleet.
LEGACY_CLIENT_EMAIL = "shared-legacy"
# Managed labels use this prefix. Legacy clients are `u:<userId>`; device
# credentials append device ID and credential UUID so a rotated UUID cannot be
# mistaken for the still-installed previous generation.
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


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Never forward a node bearer token to a redirected destination."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(
            req.full_url, code, "redirects are disabled", headers, fp
        )


def env(name: str, *, required: bool = True) -> str:
    value = os.environ.get(name, "").strip()
    if not value and required:
        raise Refusal(f"{name} must be set")
    return value


def api_base() -> str:
    raw = env("TONO_API_BASE").rstrip("/")
    try:
        parsed = urllib.parse.urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        raise Refusal("TONO_API_BASE must be an HTTPS origin on port 443") from error
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise Refusal("TONO_API_BASE must be an HTTPS origin on port 443")
    return raw


def open_control_plane(request: urllib.request.Request, timeout: int):
    try:
        return urllib.request.build_opener(NoRedirect).open(request, timeout=timeout)
    except urllib.error.HTTPError as error:
        error.close()
        raise


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
    starts again from zero under a second name. Production sets the control
    plane's exit node ID; the machine identity is the stable legacy fallback.

    A persisted name cannot change automatically. A queued cumulative report may
    or may not already have reached the old ledger; rewriting it can double bill
    history, while dropping it can lose usage. Existing nodes must therefore be
    provisioned under the source identity already recorded in this state file.
    """
    configured = env("TONO_SOURCE_ID", required=False) or machine_identity()
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
            "this exit has no stable identity to report under; set TONO_SOURCE_ID"
        )
    recorded = state.get("sourceId")
    if isinstance(recorded, str) and recorded and recorded != source:
        raise Refusal(
            f"TONO_SOURCE_ID {source!r} does not match durable source {recorded!r}; "
            "provision the exit node with the durable source id"
        )
    for report in state["pendingReports"]:
        if not isinstance(report, dict) or report.get("sourceId") != source:
            raise Refusal("a queued usage report does not match the durable source id")
    state["sourceId"] = source
    return source


def client_label(user_id: str, device_id: str | None = None,
                 client_uuid: str | None = None) -> str:
    """The credential-generation label a client is installed and counted under."""
    if device_id:
        if not client_uuid:
            raise Refusal("a device-scoped client label requires its credential UUID")
        generation = hashlib.sha256(client_uuid.encode("ascii")).hexdigest()
        return f"{CLIENT_LABEL_PREFIX}{user_id}:{device_id}:{generation}"
    return f"{CLIENT_LABEL_PREFIX}{user_id}"


def attributed_user(label: str) -> str | None:
    """The account a counter belongs to, or None when the label is not ours.

    `shared-legacy` and anything added by hand carry traffic that belongs to no
    single account; reporting it against one would bill the wrong customer.
    Supports device-scoped credential-generation labels:
    `u:<user_id>:<device_id>:<credential_digest>`.
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


def add_inbound_user(
    binary: Path, command: str, address: str, tag: str, label: str, client_uuid: str,
) -> subprocess.CompletedProcess[str]:
    """Install one VLESS identity. Xray 26+ `adu` takes an inbound JSON snippet."""
    if command != "adu":
        return run_xray(binary, [
            "api", command, f"--server={address}",
            f"--tag={tag}", f"--email={label}", f"--uuid={client_uuid}",
        ])
    snippet = {
        "inbounds": [{
            "tag": tag,
            "protocol": "vless",
            "listen": "127.0.0.1",
            "port": 1,
            "settings": {
                "decryption": "none",
                "clients": [{
                    "email": label,
                    "id": client_uuid,
                    "flow": "xtls-rprx-vision",
                }],
            },
        }],
    }
    fd, path = tempfile.mkstemp(prefix="tono-adu-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(snippet, handle)
        os.chmod(path, 0o600)
        return run_xray(binary, ["api", "adu", f"--server={address}", path])
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


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


def fetch_roster(base: str, token: str) -> tuple[str, int, list[dict[str, str]], bool]:
    request = urllib.request.Request(
        f"{base}/api/v1/home/exit-identities",
        headers=REQUEST_HEADERS,
        method="GET",
    )
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    with open_control_plane(request, timeout=20) as response:
        payload = json.loads(response.read(MAX_RESPONSE_BYTES).decode("utf-8"))
    return parse_roster(payload)


def parse_roster(payload: dict) -> tuple[str, int, list[dict[str, str]], bool]:
    """Validate a roster document, fresh from the control plane or its saved copy."""
    node_id = payload.get("nodeId")
    observed_at = payload.get("observedAt")
    identities = payload.get("identities")
    if not isinstance(node_id, str) or not SOURCE_ID_PATTERN.fullmatch(node_id):
        raise Refusal("roster response has no valid authenticated nodeId")
    if (
        not isinstance(observed_at, int)
        or isinstance(observed_at, bool)
        or not isinstance(identities, list)
    ):
        raise Refusal("roster response is not the documented shape")
    retire_shared_legacy = payload.get("retireSharedLegacy", False)
    if not isinstance(retire_shared_legacy, bool):
        raise Refusal("roster response has an invalid retireSharedLegacy signal")
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
            # Presence means this is a device-scoped credential. Treating a bad
            # value as absent silently downgrades it to the legacy u:<user>
            # label, where two devices can overwrite each other and the wrong
            # identity can remain installed.
            raise Refusal("roster entry has an invalid deviceId")
        roster.append({"userId": user_id, "clientUUID": client_uuid, "deviceId": device_id})
    if len({entry["clientUUID"] for entry in roster}) != len(roster):
        raise Refusal("roster repeats an identity, which would merge two accounts' counters")
    return node_id, observed_at, roster, retire_shared_legacy


def acknowledge_roster(base: str, token: str, observed_at: int) -> None:
    body = json.dumps({"observedAt": observed_at}).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/api/v1/home/roster-ack",
        data=body,
        headers={
            "content-type": "application/json",
            **REQUEST_HEADERS,
        },
        method="POST",
    )
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        with open_control_plane(request, timeout=20) as response:
            response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as error:
        error.close()
        raise Refusal(
            f"roster ack failed: control plane answered {error.code} {error.reason}"
        ) from error
    except (urllib.error.URLError, OSError) as error:
        raise Refusal(f"roster ack failed: {error}") from error


def acknowledge_metering(base: str, token: str, observed_at: int) -> None:
    body = json.dumps({
        "meteringProtocolVersion": 2,
        "observedAt": observed_at,
    }).encode("utf-8")
    request = urllib.request.Request(
        f"{base}/api/v1/home/metering-ack",
        data=body,
        headers={"content-type": "application/json", **REQUEST_HEADERS},
        method="POST",
    )
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        with open_control_plane(request, timeout=20) as response:
            response.read(MAX_RESPONSE_BYTES)
    except urllib.error.HTTPError as error:
        error.close()
        raise Refusal(
            f"metering ack failed: control plane answered {error.code} {error.reason}"
        ) from error
    except (urllib.error.URLError, OSError) as error:
        raise Refusal(f"metering ack failed: {error}") from error


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
    for key, kind in (("installedClients", list), ("sourceId", str), ("startMarker", str),
                      ("lastReportObservedAt", int)):
        if key in state and not isinstance(state[key], kind):
            raise Refusal(f"state file is corrupt: {key}")
    last_report_at = state.get("lastReportObservedAt")
    if (
        isinstance(last_report_at, bool)
        or isinstance(last_report_at, int)
        and not 0 <= last_report_at <= MAX_SAFE_INTEGER
    ):
        raise Refusal("state file is corrupt: lastReportObservedAt")
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


def roster_cache_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.roster")


def control_plane_unreachable(error: BaseException) -> bool:
    """Whether a roster fetch failed without the control plane answering it.

    Only then may the node fall back to its last verified roster. Any other
    answer, such as a rejected or disabled token, a roster that fails validation
    or another node's roster, is the control plane speaking, and it discards
    the copy.
    """
    if isinstance(error, urllib.error.HTTPError):
        return error.code in RETRYABLE_STATUSES or error.code >= 500
    return isinstance(error, (OSError, http.client.HTTPException))


def discard_roster_cache(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError as error:
        raise Refusal(f"the saved roster could not be removed: {error}") from error


def save_roster_cache(path: Path, node_id: str, observed_at: int,
                      roster: list[dict[str, str]], retire_shared_legacy: bool) -> str | None:
    """Keep the roster just verified, for an Xray restart during an outage.

    The copy holds client credentials, so it is owner-only from creation and
    replaced atomically. If it cannot be written, the previous copy is removed:
    an older list may still name an account this roster has revoked. Returns an
    error only when even that removal failed.
    """
    document = {
        "version": ROSTER_CACHE_VERSION,
        "savedAt": int(time.time()),
        "nodeId": node_id,
        "observedAt": observed_at,
        "retireSharedLegacy": retire_shared_legacy,
        "identities": roster,
    }
    temporary: str | None = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".roster-", dir=path.parent)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            os.fchmod(output.fileno(), STATE_MODE)
            json.dump(document, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        temporary = None
        return None
    except OSError as error:
        print(f"the roster could not be saved for outages: {error}", file=sys.stderr)
        try:
            discard_roster_cache(path)
        except Refusal as refusal:
            return str(refusal)
        return None
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def load_roster_cache(path: Path, source: str) -> tuple[list[dict[str, str]], bool, int]:
    """The last verified roster and its age, or a Refusal saying why not."""
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    except FileNotFoundError as error:
        raise Refusal("there is no saved roster") from error
    except OSError as error:
        raise Refusal(f"the saved roster cannot be read: {error}") from error
    with os.fdopen(descriptor, "r", encoding="utf-8") as handle:
        info = os.fstat(handle.fileno())
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or info.st_mode & 0o077):
            raise Refusal("the saved roster is not a private service-owned file")
        try:
            document = json.load(handle)
        except ValueError as error:
            raise Refusal("the saved roster is corrupt") from error
    if not isinstance(document, dict) or document.get("version") != ROSTER_CACHE_VERSION:
        raise Refusal("the saved roster is not a version this agent reads")
    saved_at = document.get("savedAt")
    if not isinstance(saved_at, int) or isinstance(saved_at, bool):
        raise Refusal("the saved roster has no valid savedAt")
    age = int(time.time()) - saved_at
    # A clock that moved backwards gives no usable age either.
    if not 0 <= age <= ROSTER_CACHE_MAX_AGE_SECONDS:
        raise Refusal(f"the saved roster is {age}s old, outside 0-{ROSTER_CACHE_MAX_AGE_SECONDS}s")
    node_id, _, roster, retire_shared_legacy = parse_roster(document)
    if node_id != source:
        raise Refusal("the saved roster belongs to another exit node")
    return roster, retire_shared_legacy, age


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
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():
            raise Refusal("exit-agent lock file is not service-owned regular file")
        os.fchmod(descriptor, STATE_MODE)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN, errno.EWOULDBLOCK):
                raise
            raise Refusal("another exit-agent run is still active") from error
        yield
    finally:
        os.close(descriptor)


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
              recorded: set[str] | None,
              retire_shared_legacy: bool = False) -> tuple[int, int, set[str] | None]:
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
    wanted = {
        client_label(entry["userId"], entry.get("deviceId"), entry["clientUUID"]): entry["clientUUID"]
        for entry in roster
    }
    # A verified empty roster is the enforcement result after the final active
    # account expires, is disabled, or reaches quota. It must remove this
    # agent's `u:` clients or those accounts keep connecting forever. When both
    # the live listing and our durable record are unknown, retain the original
    # fail-safe and remove nothing; the shared legacy identity is outside the
    # namespace in either case.
    if not wanted and listed is None and recorded is None:
        return 0, 0, None
    installed = listed if listed is not None else recorded
    known_installed = None if installed is None else {
        label for label in installed
        if label == LEGACY_CLIENT_EMAIL or label.startswith(CLIENT_LABEL_PREFIX)
    }
    removed = 0
    if installed is None:
        print("this exit cannot say which clients it holds; removed nothing")
    else:
        for label in sorted(installed - set(wanted)):
            # Only this agent's own namespace is a candidate, except when explicitly
            # retiring the shared-legacy client. Hand-added entries belong to somebody
            # else and are never touched.
            if label == LEGACY_CLIENT_EMAIL:
                if not retire_shared_legacy:
                    continue
            elif not label.startswith(CLIENT_LABEL_PREFIX):
                continue
            result = run_xray(binary, [
                "api", commands["remove_user"], f"--server={address}",
                f"--tag={tag}", f"--email={label}",
            ])
            if result.returncode != 0 and "not found" not in (result.stderr or "").lower():
                raise Refusal(f"removing {label} failed: {result.stderr.strip() or result.returncode}")
            if known_installed is not None:
                known_installed.discard(label)
            removed += 1
    # Remove an obsolete credential generation before adding its replacement.
    # Xray rejects the same UUID while it is still attached to the old email;
    # adding first and removing second can therefore leave the device offline
    # for a full poll cycle. The UUID suffix also gives the new generation a new
    # counter key, so an old baseline cannot hide its first bytes of traffic.
    added = 0
    for label, client_uuid in sorted(wanted.items()):
        if listed is not None and label in listed:
            continue
        result = add_inbound_user(
            binary, commands["add_user"], address, tag, label, client_uuid,
        )
        # Already-present is success, not failure: two agents on one timer, or a
        # retry after a lost response, must not turn into an error loop. It is
        # not an addition either, or every round would report the whole roster.
        # Xray 26 `adu` prints "already exists" on stdout and may still exit 0.
        output = f"{result.stdout or ''}\n{result.stderr or ''}".lower()
        if "already exists" in output:
            pass
        elif result.returncode != 0:
            raise Refusal(f"adding {label} failed: {result.stderr.strip() or result.returncode}")
        else:
            added += 1
        if known_installed is not None:
            known_installed.add(label)
    return added, removed, known_installed


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


def aggregate_user_totals(totals: dict[str, int]) -> dict[str, int]:
    """Aggregate per-device/label lifetime totals into per-account lifetime totals.

    An account may have multiple device and credential-generation labels on this
    exit node. Accounting is per-user, so they must all sum into one monotonic
    lifetime total for this source.
    """
    user_totals: dict[str, int] = {}
    for label, total in totals.items():
        user_id = attributed_user(label)
        if user_id is None:
            continue
        user_totals[user_id] = user_totals.get(user_id, 0) + int(total)
    return user_totals


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
    for attempt in range(1, DELIVERY_ATTEMPTS + 1):
        request = urllib.request.Request(
            f"{base}/api/v1/home/usage",
            data=body,
            headers={
                "content-type": "application/json",
                **REQUEST_HEADERS,
            },
            method="POST",
        )
        request.add_unredirected_header("Authorization", f"Bearer {token}")
        try:
            with open_control_plane(request, timeout=30) as response:
                response.read(MAX_RESPONSE_BYTES)
            return
        except urllib.error.HTTPError as error:
            error.close()
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
    behind it. Its local reported watermark is rolled back so the cumulative
    figure is regenerated next round even if that account has since gone idle.
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
            rejected = batch[0]
            reported_totals = state.get("userTotals")
            if (
                isinstance(reported_totals, dict)
                and isinstance(rejected.get("userId"), str)
                and isinstance(rejected.get("totalBytes"), int)
                and reported_totals.get(rejected["userId"]) == rejected["totalBytes"]
            ):
                reported_totals.pop(rejected["userId"], None)
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
    roster: list[dict[str, str]] | None,
    recorded: set[str] | None,
    retire_shared_legacy: bool = False,
) -> tuple[int, int, set[str] | None, dict[str, int], str | None]:
    """Reconcile and read counters from one Xray process generation.

    A restart after the first marker can drop every API-installed client and
    reset every counter. Comparing only the new reading with the old baseline is
    insufficient when a busy account's new counter has already climbed above
    that baseline: it looks like a small increase and silently forgives the
    bytes before it. Retry the whole mutation/read once against the new process;
    a node that keeps restarting is unknown rather than billable guesswork.
    A `None` roster changes no client and only reads the counters.
    """
    for attempt in range(2):
        marker_before = xray_start_marker(binary)
        if roster is None:
            added, removed, installed = 0, 0, None
        else:
            listed = installed_clients(binary, commands, address, tag)
            added, removed, installed = reconcile(
                binary, commands, address, tag, roster, listed, recorded,
                retire_shared_legacy=retire_shared_legacy,
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


def sync_hy2_roster(roster: list[dict[str, str]]) -> bool:
    """Replace an installed hy2 checker's list from this verified roster only.

    No hy2 directory means a VLESS-only node, which is unchanged. An installed
    but broken/read-only path is an error, never a successful reconciliation.
    Empty is a valid revocation result, not permission to retain static users.
    Caller holds agent_run_lock and has verified the roster's node identity.
    """
    path = HY2_AUTH_ALLOWLIST
    try:
        directory = path.parent.lstat()
    except FileNotFoundError:
        return False
    if (not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.geteuid()
            or directory.st_mode & 0o022):
        raise Refusal("hy2 auth directory is not privately service-owned")
    try:
        info = path.lstat()
    except FileNotFoundError as error:
        raise Refusal("hy2 is installed but its auth allowlist is missing") from error
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_nlink != 1 or info.st_mode & 0o022):
        raise Refusal("hy2 auth allowlist is not a service-owned regular file")
    digests = sorted({hashlib.sha256(entry["clientUUID"].encode()).hexdigest() for entry in roster})
    body = (HY2_ROSTER_MARKER + "\n" + "".join(digest + "\n" for digest in digests)).encode()
    temporary: str | None = None
    try:
        # Same-directory replacement: a reader sees either complete roster,
        # never a partially truncated list. Preserve the checker's read group.
        descriptor, temporary = tempfile.mkstemp(prefix=".auth-allow-", dir=path.parent)
        with os.fdopen(descriptor, "wb") as output:
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
            os.fchmod(output.fileno(), 0o640)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        temporary = None
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        raise Refusal(f"hy2 roster could not be published: {error}") from error
    finally:
        if temporary is not None:
            os.unlink(temporary)
    return True



def run_hy2_roster_once() -> None:
    """Enforce hy2 only; never opt a VLESS node into a metering migration.

    No node-wide ACK is sent: this mode cannot prove Xray reconciliation or
    metering readiness. The node-specific token and explicit source must agree.
    """
    base = api_base()
    token = env("TONO_HOME_AGENT_TOKEN")
    expected = env("TONO_SOURCE_ID")
    if not SOURCE_ID_PATTERN.fullmatch(expected):
        raise Refusal("hy2-only sync requires an explicit valid TONO_SOURCE_ID")
    node_id, observed_at, roster, _ = fetch_roster(base, token)
    if node_id != expected:
        raise Refusal("hy2 roster node identity does not match TONO_SOURCE_ID")
    if not sync_hy2_roster(roster):
        raise Refusal("hy2-only sync requires an installed auth checker")
    print(f"hy2 roster applied: observedAt={observed_at}, identities={len(roster)}; no node-wide ACK or usage report")


def run_outage_round(path: Path, state: dict, source: str, binary: Path,
                     commands: dict[str, str], address: str, tag: str,
                     retire_override: str, failure: BaseException) -> None:
    """Serve and meter the last verified roster while the control plane is down.

    Xray loses every API-added client when it restarts, so without this a
    restart during an outage locks out every account on the node until the
    control plane returns. The saved roster is the list the running Xray held
    before the restart and nothing newer, so reinstalling it grants no one
    anything a live process would not have kept. A copy older than a day, or
    one that is missing or unreadable, restores nothing.

    Counters are folded either way, so a restart cannot forgive the usage
    before it. Reports need the control plane's roster clock, so the growth is
    kept in the durable totals and reported by the next round that reaches it.
    Nothing is acknowledged, and the round always exits non-zero.
    """
    try:
        roster, server_retire, age = load_roster_cache(roster_cache_path(path), source)
    except Refusal as refusal:
        roster, server_retire, age, unusable = None, False, 0, refusal
    retire_shared_legacy = (
        server_retire
        if not retire_override
        else retire_override in ("1", "true", "yes")
    )
    remembered = state.get("installedClients")
    added, removed, installed, counters, settled_marker = reconcile_and_read_stable(
        binary, commands, address, tag, roster,
        set(remembered) if isinstance(remembered, list) else None,
        retire_shared_legacy=retire_shared_legacy,
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
    if not isinstance(state.get("userTotals"), dict):
        # The next reporting round compares against this; without it, that
        # round would treat the growth folded here as already reported.
        state["userTotals"] = aggregate_user_totals(state["totals"])
    totals = lifetime_totals(state, counters, restarted=restarted)
    state["totals"] = {label: int(value) for label, value in totals.items()}
    if settled_marker:
        state["startMarker"] = settled_marker
    else:
        state.pop("startMarker", None)
    save_state(path, state)
    if roster is None:
        raise Refusal(
            f"control plane unreachable ({failure}) and {unusable}; restored no clients."
            " Usage is kept locally"
        ) from failure
    raise Unreachable(
        f"control plane unreachable ({failure}); applied the roster verified {age}s ago"
        f" (+{added} -{removed}). Usage is kept locally"
    ) from failure


def run_once(path: Path) -> None:
    base = api_base()
    token = env("TONO_HOME_AGENT_TOKEN")
    binary = xray_binary()
    address = api_address()
    tag = inbound_tag()
    state = load_state(path)
    source = source_id(state)
    commands = require_commands(binary)

    retire_override = env("TONO_RETIRE_SHARED_LEGACY", required=False)
    cache = roster_cache_path(path)
    try:
        node_id, observed_at, roster, server_retire_shared_legacy = fetch_roster(base, token)
    except Exception as error:
        if not control_plane_unreachable(error):
            discard_roster_cache(cache)
            raise
        run_outage_round(path, state, source, binary, commands, address, tag,
                         retire_override, error)
        raise
    if node_id != source:
        discard_roster_cache(cache)
        raise Refusal(
            f"authenticated exit node {node_id!r} does not match durable source {source!r}"
        )
    # Saved before anything is enforced, so the copy never trails a revocation
    # this round has already seen.
    cache_error = save_roster_cache(
        cache, node_id, observed_at, roster, server_retire_shared_legacy,
    )
    for report in state["pendingReports"]:
        pending_at = report.get("observedAt")
        if (
            not isinstance(pending_at, int)
            or isinstance(pending_at, bool)
            or not 0 <= pending_at <= MAX_SAFE_INTEGER
        ):
            raise Refusal("a queued usage report has an invalid observedAt")
        if pending_at > observed_at + 300:
            # A 400 is normally isolated and dropped so one bad account cannot
            # wedge the queue. This report is locally known to be outside the
            # server window, though, so retain it until the server clock catches
            # up instead of silently losing the last growth for an idle account.
            raise Refusal("queued usage is more than five minutes ahead of the roster clock")
    # An explicit environment value wins in both directions so an operator can
    # stop an automatic retirement. An unset value follows the control plane.
    retire_shared_legacy = (
        server_retire_shared_legacy
        if not retire_override
        else retire_override in ("1", "true", "yes")
    )
    # Revocations must reach hy2 even if the following Xray reconciliation
    # fails. Never ACK the roster unless both installed transports were updated.
    sync_hy2_roster(roster)
    remembered = state.get("installedClients")
    added, removed, installed, counters, settled_marker = reconcile_and_read_stable(
        binary, commands, address, tag, roster,
        set(remembered) if isinstance(remembered, list) else None,
        retire_shared_legacy=retire_shared_legacy,
    )
    if cache_error:
        # An older saved roster is still on disk and may name an account this
        # roster revoked. Never report the round as complete while it is.
        raise Refusal(cache_error)
    if installed is None:
        # Additions can be attempted safely without a live listing, but they do
        # not prove that an old credential generation or shared-legacy client
        # is absent. Never turn that partial result into rollout readiness.
        raise Refusal(
            "the live client inventory is unavailable and no durable inventory can prove complete reconciliation"
        )
    # Only a complete reconciliation is readiness evidence. Do this before any
    # state save so a failed acknowledgement leaves the durable state intact and
    # the whole roster can be retried next round.
    acknowledge_roster(base, token, observed_at)

    # A batch the server accepted but that was never acknowledged here goes out
    # before newly measured usage: the figure is cumulative per source, so
    # re-sending it counts nothing twice, and losing the acknowledgement must not
    # lose usage.
    if state["pendingReports"]:
        state["pendingReports"] = merge_reports(state["pendingReports"], [])
        save_state(path, state)
        replayed, discarded = deliver_queue(base, token, path, state)
        print(f"replayed {replayed} queued report(s), dropped {discarded}")

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
    current_user_totals = aggregate_user_totals(totals)
    previous_user_totals = state.get("userTotals")
    if not isinstance(previous_user_totals, dict):
        previous_user_totals = aggregate_user_totals(state.get("totals", {}))

    reports: list[dict] = []
    timestamp = max(observed_at, int(state.get("lastReportObservedAt", -1)) + 1)
    if timestamp > observed_at + 300:
        # The server rejects observations more than five minutes beyond its own
        # clock. Keep the old baseline durable so the bytes are measured again
        # after server time catches up, rather than queueing a report that a 400
        # response would discard before any later traffic arrives.
        raise Refusal("usage report clock is more than five minutes ahead of the roster clock")
    for user_id in sorted(current_user_totals):
        total = current_user_totals[user_id]
        previous = int(previous_user_totals.get(user_id, 0))
        if total < previous:
            raise Refusal(f"total for {user_id} moved backwards, which is never correct")
        if total > previous:
            reports.append({
                "reportId": str(uuid.uuid4()),
                "userId": user_id,
                "sourceId": source,
                # v2 observedAt is a server-roster-derived monotonic sequence.
                # The control plane accepts one final wall-clock v1 transition,
                # then rejects delayed v1 growth and retained-report replays.
                "protocolVersion": 2,
                "totalBytes": total,
                "observedAt": timestamp,
            })
    state["totals"] = {label: int(value) for label, value in totals.items()}
    state["userTotals"] = {user_id: int(value) for user_id, value in current_user_totals.items()}
    if reports:
        # Usage retention eventually removes report-id rows. A timestamp that
        # always moves forward lets the control plane distinguish a genuinely
        # new high-water mark from an old ID replayed after a counter reset.
        # Anchor it to the server-issued roster time so a bad node clock cannot
        # stall billing or manufacture a future observation.
        state["lastReportObservedAt"] = timestamp
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
        acknowledge_metering(base, token, observed_at)
        print("no new usage to report")
        return
    delivered, dropped = deliver_queue(base, token, path, state)
    acknowledge_metering(base, token, observed_at)
    print(f"reported usage for {delivered} accounts as {source}, dropped {dropped}")


def main(*, hy2_roster_only: bool = False) -> None:
    path = state_path()
    with agent_run_lock(path):
        if hy2_roster_only:
            run_hy2_roster_once()
        else:
            run_once(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hy2-roster-only", action="store_true",
                        help="sync installed hy2 auth only; no Xray changes, usage, or node-wide ACK")
    args = parser.parse_args()
    try:
        main(hy2_roster_only=args.hy2_roster_only)
    except Refusal as refusal:
        print(f"refusing: {refusal}", file=sys.stderr)
        raise SystemExit(1)
    except Unreachable as unreachable:
        # Measured and queued, just not delivered. The next run carries it.
        print(f"usage not delivered: {unreachable}", file=sys.stderr)
        raise SystemExit(1)
    except urllib.error.HTTPError as error:
        error.close()
        print(f"control plane returned {error.code}: {error.reason}", file=sys.stderr)
        raise SystemExit(1)
