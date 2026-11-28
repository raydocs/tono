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
import ipaddress
import json
import os
import re
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

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
# The roster grows with the fleet's devices (~150 bytes each). A cut-off body
# is never acted on, so the limit is set well above today's size.
MAX_ROSTER_BYTES = 8 * 1024 * 1024
STATE_MODE = 0o600
# How long the last verified roster may stand in for an unreachable control
# plane. Past this the node restores nothing: a day-old list is too likely to
# name accounts that have since been revoked, expired or run out of quota.
ROSTER_CACHE_MAX_AGE_SECONDS = 24 * 60 * 60
MAX_HOME_OUTAGE_LEASE_SECONDS = 300
ROSTER_CACHE_VERSION = 2
HY2_AUTH_ALLOWLIST = Path("/opt/tono-hy2/auth-allow.sha256")
HY2_ROSTER_MARKER = "# tono-exit-agent roster v1"
# Label written by enable-tono-exit-metering.sh for the credential every
# current client still holds. Removing it would drop the fleet.
LEGACY_CLIENT_EMAIL = "shared-legacy"
# Managed labels use these prefixes: `u:` for cloud egress, `h:` for
# node-dialed residential egress. Device credentials append device ID and
# credential digest so rotated generations never share a baseline or collision.
CLIENT_LABEL_PREFIX = "u:"
HOME_LABEL_PREFIX = "h:"
HOME_OUTBOUND_PREFIX = "home:"
API_TAG = "api"
API_INBOUND_TAG = "tono-api"
DIRECT_OUTBOUND_TAG = "direct"
HOME_BLACKHOLE_TAG = "home-blackhole"
API_RULE_TAG = "tono-api-rule"
HOME_PRIVATE_CIDRS_RULE_TAG = "tono-home-private-cidrs"
HOME_CATCHALL_RULE_TAG = "tono-home-catchall"
ROUTING_SERVICE = "RoutingService"
VERIFIED_NODE_HOME_XRAY_VERSIONS = frozenset({"26.3.27", "26.11.9"})
NODE_HOME_METERING_PROTOCOL_VERSION = 3
MAX_DRAINED_GENERATIONS_PER_ACK = 200
HOME_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,64}")
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
PRIVATE_HOME_CIDRS: tuple[str, ...] = (
    "10.0.0.0/8",
    "172.16.0.0/12",
    "192.168.0.0/16",
    "127.0.0.0/8",
    "169.254.0.0/16",
    "100.64.0.0/10",
    "fc00::/7",
    "fe80::/10",
    "::1/128",
)
REQUIRED_NODE_HOME_COMMANDS = (
    "add_user",
    "remove_user",
    "list_users",
    "stats_query",
    "add_outbound",
    "remove_outbound",
    "list_outbounds",
    "add_rules",
    "list_rules",
)
# Opt-in stuck-revocation restart (TONO_RESTART_XRAY_ON_STUCK_REVOCATION=1).
STUCK_REVOCATION_ROUNDS = 3
XRAY_RESTART_INTERVAL_SECONDS = 60 * 60
MAX_RESTARTS_UNCONVERGED = 2
# No new restore attempt starts more than 30 s after systemctl returns; past
# that the next timer round (60 s after this one ends) restores the roster.
# One attempt already started can still run to its own RPC timeouts.
RESTART_SETTLE_DEADLINE_SECONDS = 30
RESTART_SETTLE_SECONDS = 2
SYSTEMCTL = "/usr/bin/systemctl"
XRAY_UNIT = "tono-xray.service"
CHILD_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C"}
SOURCE_ID_PATTERN = re.compile(r"[A-Za-z0-9._-]{1,64}")
# The control plane's answer for a token that belongs to a disabled or retired
# node. Only this exact 403 body withdraws clients; a bare 401/403, an edge
# block page or a network failure keeps the last roster and retries.
EXIT_NODE_DISABLED_CODE = "EXIT_NODE_DISABLED"
REQUEST_HEADERS = {
    "accept": "application/json",
    # Zone browser-integrity rejects a bare urllib UA with CF 403/1010.
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) tono-exit-agent/1.0",
}


class Refusal(RuntimeError):
    """A condition the operator must fix. Never worked around silently."""


class PartialReconcile(Refusal):
    """Some client adds or removals failed; the others were applied.

    The counters are still worth reading: one client the API refuses must not
    stop metering, and so quota enforcement, for every account on the node.
    """


class Rejection(RuntimeError):
    """A batch the control plane refused. Offering it again changes nothing."""


class Unreachable(RuntimeError):
    """Delivery did not get through. The queue keeps it for the next run."""


class NodeDisabled(RuntimeError):
    """The control plane says this exit node is disabled, retired or holds a
    superseded token (#1296). `reason` is the control plane's own message."""

    def __init__(self, message: str, reason: str = "") -> None:
        super().__init__(message)
        self.reason = reason


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
        # Keep a bounded error body so a caller can tell an explicit control
        # plane answer from an edge page; the response itself is closed here.
        try:
            error.tono_body = error.read(4096) if error.fp else b""
        except OSError:
            error.tono_body = b""
        error.close()
        raise


def is_node_disabled(error: urllib.error.HTTPError) -> bool:
    if error.code != 403:
        return False
    try:
        payload = json.loads(getattr(error, "tono_body", b"") or b"")
    except (ValueError, UnicodeDecodeError):
        return False
    detail = payload.get("error") if isinstance(payload, dict) else None
    return isinstance(detail, dict) and detail.get("code") == EXIT_NODE_DISABLED_CODE


def node_disabled_reason(error: urllib.error.HTTPError) -> str:
    """The control plane's message on an EXIT_NODE_DISABLED answer, bounded and
    printable so the operator can tell a disabled node from a superseded token."""
    try:
        payload = json.loads(getattr(error, "tono_body", b"") or b"")
        message = payload["error"]["message"]
    except (ValueError, UnicodeDecodeError, KeyError, TypeError):
        return ""
    if not isinstance(message, str):
        return ""
    return "".join(c for c in message if c.isprintable())[:120]


def xray_binary() -> Path:
    path = Path(env("TONO_XRAY_BINARY", required=False) or "/opt/tono-xray/current/xray")
    if not path.is_file() or not os.access(path, os.X_OK):
        raise Refusal(f"xray binary not found or not executable at {path}")
    return path


def xray_config_path() -> Path:
    # The static config tono-xray loads at start. shared-legacy lives here, so a
    # retirement that only reaches the running process is undone by a restart.
    return Path(env("TONO_XRAY_CONFIG", required=False) or "/opt/tono-xray/current/config.json")


def retire_override(raw: str) -> bool | None:
    """The operator's TONO_RETIRE_SHARED_LEGACY, or None when unset.

    Case and common spellings are accepted. Anything else keeps shared-legacy
    as it is this round and warns: retirement is persisted to the static
    config and cannot be undone by a later `false`, so a typo during rollback
    must not trigger it.
    """
    value = raw.strip().lower()
    if not value:
        return None
    if value in ("1", "true", "yes", "on"):
        return True
    if value in ("0", "false", "no", "off"):
        return False
    print(f"TONO_RETIRE_SHARED_LEGACY={raw!r} is not true/false; leaving shared-legacy as it is",
          file=sys.stderr)
    return False


def api_address() -> str:
    # The management inbound. Localhost-only by design: this is the interface that
    # can add and remove accounts.
    return env("TONO_XRAY_API_ADDRESS", required=False) or "127.0.0.1:10085"


def inbound_tag() -> str:
    tag = env("TONO_XRAY_INBOUND_TAG", required=False) or "tono-vless"
    # Xray echoes the tag in its errors; one with a line break could print a
    # whole success line of its own.
    if not re.fullmatch(r"[A-Za-z0-9._-]+", tag):
        raise Refusal("TONO_XRAY_INBOUND_TAG may only hold letters, digits, '.', '_' and '-'")
    return tag


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
    source = configured_source()
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


def configured_source() -> str:
    """This exit's configured name, before any comparison with durable state."""
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
    return source


def is_managed_label(label: str) -> bool:
    """Whether `label` belongs to either managed exit-agent namespace (`u:` or `h:`)."""
    return label.startswith(CLIENT_LABEL_PREFIX) or label.startswith(HOME_LABEL_PREFIX)


def client_label(user_id: str, device_id: str | None = None,
                 client_uuid: str | None = None,
                 *, prefix: str = CLIENT_LABEL_PREFIX) -> str:
    """The credential-generation label a client is installed and counted under."""
    if device_id:
        if not client_uuid:
            raise Refusal("a device-scoped client label requires its credential UUID")
        generation = hashlib.sha256(client_uuid.encode("ascii")).hexdigest()
        return f"{prefix}{user_id}:{device_id}:{generation}"
    return f"{prefix}{user_id}"


def home_client_label(user_id: str, device_id: str, client_uuid: str) -> str:
    """The `h:` residential credential-generation label."""
    return client_label(user_id, device_id, client_uuid, prefix=HOME_LABEL_PREFIX)


def home_outbound_tag(home_exit_id: str, binding_generation: str) -> str:
    """Per-tenant Xray outbound tag isolating residential streams for drain & teardown."""
    return f"{HOME_OUTBOUND_PREFIX}{home_exit_id}:{binding_generation}"


def parse_home_outbound_tag(tag: str) -> tuple[str, str] | None:
    if not tag.startswith(HOME_OUTBOUND_PREFIX):
        return None
    rest = tag[len(HOME_OUTBOUND_PREFIX):]
    if ":" not in rest:
        return None
    home_exit_id, binding_generation = rest.split(":", 1)
    if HOME_ID_PATTERN.fullmatch(home_exit_id) and HOME_ID_PATTERN.fullmatch(binding_generation):
        return home_exit_id, binding_generation
    return None


def attributed_user(label: str) -> str | None:
    """The account a counter belongs to, or None when the label is not ours.

    `shared-legacy` and anything added by hand carry traffic that belongs to no
    single account; reporting it against one would bill the wrong customer.
    Supports both cloud (`u:<user_id>[:<device_id>:<digest>]`) and residential
    (`h:<user_id>:<device_id>:<digest>`) namespaces without double-billing.
    """
    for prefix in (CLIENT_LABEL_PREFIX, HOME_LABEL_PREFIX):
        if label.startswith(prefix):
            raw = label[len(prefix):]
            return raw.split(":")[0] or None
    return None


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
    if not _one_line(label):
        return _refused(label)
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


def remove_inbound_user(
    binary: Path, command: str, address: str, tag: str, email: str,
) -> subprocess.CompletedProcess[str]:
    """Remove one identity. Xray 26 `rmu` takes `-tag=` and positional emails;
    it rejects `--email=` outright. `removeuser` gets the same form."""
    if not _one_line(email):
        return _refused(email)
    return run_xray(binary, ["api", command, f"--server={address}", f"-tag={tag}", email])


def _output_lines(result: subprocess.CompletedProcess[str]) -> list[str]:
    return f"{result.stdout or ''}\n{result.stderr or ''}".splitlines()


def _total_at_least_one(lines: list[str], verb: str) -> bool:
    for line in lines:
        match = re.fullmatch(rf"{verb} (\d+) user\(s\) in total\.", line.strip())
        if match and int(match.group(1)) >= 1:
            return True
    return False


def _legacy_user_line(lines: list[str], email: str, outcome: str) -> bool:
    # Pre-26 removeuser/adduser/adi print "... User <email> <outcome>." with a
    # non-zero exit. Only a whole line naming this email counts: an echoed
    # email cannot contain a line that names itself.
    pattern = rf"(?:.*: )?User {re.escape(email)} {outcome}\.?"
    return any(re.fullmatch(pattern, line.strip(), re.IGNORECASE) for line in lines)


def _vless_user_error(lines: list[str], email: str, outcome: str) -> bool:
    pattern = rf"rpc error: code = \w+ desc = proxy/vless: User {re.escape(email)} {outcome}\."
    return any(re.fullmatch(pattern, line.strip()) for line in lines)


def _one_line(email: str) -> bool:
    # Xray echoes the email; one with a line break could print a whole
    # success line of its own. Such an email is never judged a success.
    return email.isprintable()


def _refused(email: str) -> subprocess.CompletedProcess[str]:
    # Not run at all: a NUL byte would make subprocess raise and skip every
    # later removal. The email stays out of the message, or the legacy
    # "already exists"/"not found" checks would read it as a result.
    return subprocess.CompletedProcess([], 1, "", "refused a non-printable email")


def removal_succeeded(result: subprocess.CompletedProcess[str], email: str, command: str = "rmu") -> bool:
    """Whether `rmu` removed `email` or it was already absent.

    Xray 26 `rmu` exits 0 even when a removal fails, so the exit code alone
    proves nothing. Only whole lines count (main/commands/all/api/
    inbound_user_remove.go, v26.3.27): an echoed email or tag must not pass as
    a total or a per-user result. A wrong inbound tag prints "handler not
    found" and "Removed 0 user(s) in total.". The legacy `removeuser` keeps
    its exit-code rule.
    """
    if not _one_line(email):
        return False
    if command != "rmu":
        return result.returncode == 0 or _legacy_user_line(_output_lines(result), email, "not found")
    lines = _output_lines(result)
    if result.returncode == 0 and _total_at_least_one(lines, "Removed"):
        return True
    if any("failed to get handler" in line or "handler not found" in line for line in lines):
        return False
    return _vless_user_error(lines, email, "not found")


def addition_outcome(result: subprocess.CompletedProcess[str], email: str) -> str:
    """"added", "present" or "failed" for one `adu` run.

    Like `rmu`, `adu` exits 0 after an RPC error and prints "Added 0 user(s)
    in total." (main/commands/all/api/inbound_user_add.go, v26.3.27).
    """
    if not _one_line(email):
        return "failed"
    lines = _output_lines(result)
    if _vless_user_error(lines, email, "already exists"):
        return "present"
    if result.returncode == 0 and _total_at_least_one(lines, "Added"):
        return "added"
    return "failed"


def api_error(result: subprocess.CompletedProcess[str]) -> str:
    return (result.stderr or "").strip() or (result.stdout or "").strip() or str(result.returncode)


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
    cmds = set(re.findall(r"^\s+([a-z][a-z0-9]+)\s+", text, re.MULTILINE))
    # Usage banner (`\txray api <command>`) matches the indented token pattern.
    cmds.discard("xray")
    return cmds


def require_commands(binary: Path) -> dict[str, str]:
    available = supported_api_commands(binary)
    # Names seen across versions, most specific first. Whichever exists is used.
    wanted = {
        "add_user": ("adu", "adduser", "adi"),
        "remove_user": ("rmu", "removeuser"),
    }
    # Listing the inbound's clients is what makes a removal safe, and older
    # builds do not have it — so it is looked up and lived without rather than
    # required, and its absence makes this agent remove nothing. Counters are
    # required for metering, which refuses after enforcement when they are
    # missing; their absence must not hold back a revocation. Node-home commands
    # are discovered optionally so un-migrated exits and older tests continue.
    optional = {
        "list_users": ("inbounduser", "iu"),
        "stats_query": ("statsquery", "stats"),
        "add_outbound": ("ado",),
        "remove_outbound": ("rmo",),
        "list_outbounds": ("lso",),
        "add_rules": ("adrules",),
        "list_rules": ("lsrules",),
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
    for role, candidates in optional.items():
        for candidate in candidates:
            if candidate in available:
                resolved[role] = candidate
                break
    return resolved


def node_home_commands_present(commands: dict[str, str]) -> bool:
    return all(role in commands for role in REQUIRED_NODE_HOME_COMMANDS)


def xray_version(binary: Path) -> str | None:
    """Parse Xray semantic version from `xray version` output, or None if unreadable."""
    try:
        result = run_xray(binary, ["version"])
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    for line in (result.stdout or "").splitlines():
        match = re.match(r"^Xray\s+([0-9]+(?:\.[0-9]+)+)\b", line.strip())
        if match:
            return match.group(1)
    return None


def config_has_node_home_topology(config_path: Path, tag: str) -> tuple[bool, str | None]:
    """Verify static `config.json` enforces RoutingService, AsIs, blackhole & ^h: guards."""
    try:
        document = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return False, f"cannot inspect {config_path}: {error}"
    if not isinstance(document, dict):
        return False, f"{config_path} root is not a JSON object"
    services = ((document.get("api") or {}) if isinstance(document.get("api"), dict) else {}).get("services")
    if not isinstance(services, list) or ROUTING_SERVICE not in services:
        return False, f"{config_path} api.services lacks {ROUTING_SERVICE}"
    outbounds = document.get("outbounds")
    if not isinstance(outbounds, list) or not outbounds or not isinstance(outbounds[0], dict):
        return False, f"{config_path} lacks primary freedom outbound at index 0"
    if outbounds[0].get("protocol") != "freedom":
        return False, f"{config_path} outbounds[0] is not freedom"
    if not any(
        isinstance(outbound, dict)
        and outbound.get("tag") == HOME_BLACKHOLE_TAG
        and outbound.get("protocol") == "blackhole"
        for outbound in outbounds
    ):
        return False, f"{config_path} lacks {HOME_BLACKHOLE_TAG} blackhole outbound"
    routing = document.get("routing")
    if not isinstance(routing, dict) or routing.get("domainStrategy") != "AsIs":
        return False, f"{config_path} routing.domainStrategy must be AsIs"
    vless_inbounds = [
        inbound for inbound in (document.get("inbounds") or [])
        if isinstance(inbound, dict) and inbound.get("protocol") == "vless"
    ]
    matching = [inbound for inbound in vless_inbounds if inbound.get("tag") == tag] or vless_inbounds
    if not matching:
        return False, f"{config_path} has no vless inbound"
    for inbound in matching:
        sniffing = inbound.get("sniffing")
        if not isinstance(sniffing, dict) or sniffing.get("enabled") is not False:
            return False, f"{config_path} vless inbound must disable sniffing"
    rules = routing.get("rules")
    if not isinstance(rules, list) or len(rules) < 3:
        return False, f"{config_path} lacks static fail-closed ^h: routing rules"
    r0, r1, r2 = rules[0], rules[1], rules[2]
    if not (isinstance(r0, dict) and r0.get("outboundTag") == API_TAG and API_INBOUND_TAG in (r0.get("inboundTag") or [])):
        return False, f"{config_path} rule 0 must route {API_INBOUND_TAG} -> {API_TAG}"
    if not (
        isinstance(r1, dict)
        and r1.get("outboundTag") == HOME_BLACKHOLE_TAG
        and r1.get("user") == ["regexp:^h:"]
        and isinstance(r1.get("ip"), list)
        and set(PRIVATE_HOME_CIDRS).issubset(set(r1["ip"]))
    ):
        return False, f"{config_path} rule 1 must block literal private CIDRs for ^h:"
    if not (
        isinstance(r2, dict)
        and r2.get("outboundTag") == HOME_BLACKHOLE_TAG
        and r2.get("user") == ["regexp:^h:"]
        and "ip" not in r2
        and "domain" not in r2
    ):
        return False, f"{config_path} rule 2 must catch-all ^h: -> {HOME_BLACKHOLE_TAG}"
    return True, None


def detect_node_home_capability(
    binary: Path, config_path: Path, commands: dict[str, str], tag: str,
) -> tuple[bool, str | None, str | None]:
    """Return `(capable, detected_xray_version, reason_if_incapable)`."""
    if not node_home_commands_present(commands):
        return False, None, "xray lacks required node-home API subcommands"
    ver = xray_version(binary)
    if ver is None or ver not in VERIFIED_NODE_HOME_XRAY_VERSIONS:
        return False, ver, f"unverified Xray version {ver!r}"
    topo_ok, reason = config_has_node_home_topology(config_path, tag)
    if not topo_ok:
        return False, ver, reason
    return True, ver, None


@contextmanager
def staged_json_file(state_dir: Path, prefix: str, document: dict):
    """Write a transient `0600` JSON file inside a private `0700` staging directory."""
    state_dir.mkdir(parents=True, exist_ok=True)
    staging_dir = state_dir / ".xray-staging"
    created = False
    try:
        staging_dir.mkdir(mode=0o700)
        created = True
    except FileExistsError:
        pass
    info = staging_dir.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid():
        raise Refusal("node-home staging directory is not service-owned")
    if created or (info.st_mode & 0o077):
        os.chmod(staging_dir, 0o700)
    descriptor, temp_path = tempfile.mkstemp(prefix=prefix, suffix=".json", dir=staging_dir)
    path_obj = Path(temp_path)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            os.fchmod(handle.fileno(), STATE_MODE)
            json.dump(document, handle, sort_keys=False)
            handle.flush()
        yield path_obj
    finally:
        try:
            path_obj.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            pass


def parse_loopback_address(address: str) -> tuple[str, int]:
    """Parse `host:port` and restrict direct RPC sockets strictly to loopback."""
    host_str, sep, port_str = address.rpartition(":")
    if not sep or not host_str or not port_str.isdigit():
        raise Refusal(f"invalid Xray API address {address!r}")
    port = int(port_str)
    if not 1 <= port <= 65535:
        raise Refusal(f"invalid Xray API port {port}")
    clean_host = host_str.strip()
    if clean_host.startswith("[") and clean_host.endswith("]"):
        clean_host = clean_host[1:-1]
    if clean_host != "localhost":
        try:
            if not ipaddress.ip_address(clean_host).is_loopback:
                raise Refusal("Xray API address must be loopback")
        except ValueError as error:
            raise Refusal("Xray API address must be loopback") from error
    return clean_host, port


def _pb_varint(value: int) -> bytes:
    out = bytearray()
    while value >= 0x80:
        out.append((value & 0x7F) | 0x80)
        value >>= 7
    out.append(value)
    return bytes(out)


def _pb_bytes(field_no: int, value: bytes) -> bytes:
    return _pb_varint((field_no << 3) | 2) + _pb_varint(len(value)) + value


def _pb_str(field_no: int, value: str) -> bytes:
    return _pb_bytes(field_no, value.encode("utf-8"))


def _pb_int(field_no: int, value: int) -> bytes:
    return _pb_varint((field_no << 3) | 0) + _pb_varint(value)


def _encode_test_route_request(
    *, inbound_tag_name: str, user: str, target_domain: str = "",
    target_ip: str = "", target_port: int = 443,
) -> bytes:
    ctx = bytearray()
    if inbound_tag_name:
        ctx += _pb_str(1, inbound_tag_name)
    ctx += _pb_int(2, 2)  # TCP
    if target_ip:
        ctx += _pb_bytes(4, ipaddress.ip_address(target_ip).packed)
    if target_port:
        ctx += _pb_int(6, target_port)
    if target_domain:
        ctx += _pb_str(7, target_domain)
    if user:
        ctx += _pb_str(9, user)
    req = bytearray()
    req += _pb_bytes(1, bytes(ctx))
    req += _pb_str(2, "outbound")
    return bytes(req)


def _decode_routing_context(data: bytes) -> dict[str, Any]:
    idx = 0
    decoded: dict[str, Any] = {}
    while idx < len(data):
        tag_val = 0
        shift = 0
        while True:
            byte = data[idx]
            idx += 1
            tag_val |= (byte & 0x7F) << shift
            if not (byte & 0x80):
                break
            shift += 7
        field_no, wire_type = tag_val >> 3, tag_val & 7
        if wire_type == 0:
            val = 0
            shift = 0
            while True:
                byte = data[idx]
                idx += 1
                val |= (byte & 0x7F) << shift
                if not (byte & 0x80):
                    break
                shift += 7
            decoded[f"f{field_no}"] = val
        elif wire_type == 2:
            length = 0
            shift = 0
            while True:
                byte = data[idx]
                idx += 1
                length |= (byte & 0x7F) << shift
                if not (byte & 0x80):
                    break
                shift += 7
            payload = data[idx : idx + length]
            idx += length
            if field_no == 12:
                decoded["outbound_tag"] = payload.decode("utf-8", "replace")
            elif field_no == 11:
                decoded.setdefault("outbound_group_tags", []).append(payload.decode("utf-8", "replace"))
        else:
            raise ValueError(f"unsupported protobuf wire type {wire_type}")
    return decoded


def grpc_test_route(
    address: str, *, inbound_tag_name: str, user: str,
    target_domain: str = "", target_ip: str = "", target_port: int = 443,
) -> dict[str, Any]:
    """Query `/xray.app.router.command.RoutingService/TestRoute` over stdlib h2c."""
    host, port = parse_loopback_address(address)
    body = _encode_test_route_request(
        inbound_tag_name=inbound_tag_name,
        user=user,
        target_domain=target_domain,
        target_ip=target_ip,
        target_port=target_port,
    )
    frame_payload = b"\x00" + struct.pack(">I", len(body)) + body

    def h2_frame(ftype: int, flags: int, sid: int, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))[1:]
            + bytes([ftype, flags])
            + struct.pack(">I", sid & 0x7FFFFFFF)
            + payload
        )

    def enc_int(val: int, prefix_bits: int, mask: int) -> bytes:
        max_v = (1 << prefix_bits) - 1
        if val < max_v:
            return bytes([mask | val])
        out = bytearray([mask | max_v])
        val -= max_v
        while val >= 128:
            out.append((val & 0x7F) | 0x80)
            val >>= 7
        out.append(val)
        return bytes(out)

    def enc_str(val: bytes) -> bytes:
        return enc_int(len(val), 7, 0x00) + val

    authority = f"{host}:{port}".encode("ascii")
    headers = bytearray([0x83, 0x86])  # :method POST, :scheme http
    headers += enc_int(4, 4, 0x00) + enc_str(b"/xray.app.router.command.RoutingService/TestRoute")
    headers += enc_int(1, 4, 0x00) + enc_str(authority)
    headers += enc_int(31, 4, 0x00) + enc_str(b"application/grpc")
    headers += b"\x00" + enc_str(b"te") + enc_str(b"trailers")

    with socket.create_connection((host, port), timeout=3.0) as sock:
        sock.settimeout(3.0)
        sock.sendall(b"PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n")
        sock.sendall(h2_frame(0x04, 0x00, 0, b""))
        sock.sendall(h2_frame(0x01, 0x04, 1, bytes(headers)))
        sock.sendall(h2_frame(0x00, 0x01, 1, frame_payload))
        data_bytes = bytearray()
        buf = b""
        done = False
        saw_headers = False
        while not done:
            while len(buf) < 9:
                chunk = sock.recv(4096)
                if not chunk:
                    done = True
                    break
                buf += chunk
            if len(buf) < 9:
                break
            length = int.from_bytes(buf[:3], "big")
            ftype, flags = buf[3], buf[4]
            sid = int.from_bytes(buf[5:9], "big") & 0x7FFFFFFF
            while len(buf) < 9 + length:
                chunk = sock.recv(4096)
                if not chunk:
                    done = True
                    break
                buf += chunk
            if len(buf) < 9 + length:
                break
            payload = buf[9 : 9 + length]
            buf = buf[9 + length :]
            if ftype == 0x04 and (flags & 0x01) == 0:
                sock.sendall(h2_frame(0x04, 0x01, 0, b""))
            elif ftype == 0x01 and sid == 1:
                saw_headers = True
                if flags & 0x01:
                    done = True
            elif ftype == 0x00 and sid == 1:
                data_bytes += payload
            elif ftype in (0x03, 0x07):
                done = True
        raw = bytes(data_bytes)
        if len(raw) >= 5:
            msg_len = struct.unpack(">I", raw[1:5])[0]
            decoded = _decode_routing_context(raw[5 : 5 + msg_len])
            decoded["grpc_ok"] = True
            return decoded
        return {"grpc_ok": saw_headers, "outbound_tag": ""}


def list_home_outbounds(binary: Path, commands: dict[str, str], address: str) -> dict[str, dict[str, Any]]:
    """Inspect active `home:*` SOCKS outbounds in Xray without ever logging secrets."""
    cmd = commands.get("list_outbounds")
    if not cmd:
        raise Refusal("listing outbounds failed: lso command unavailable")
    try:
        result = run_xray(binary, ["api", cmd, f"--server={address}"])
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refusal(f"listing outbounds failed: {type(error).__name__}") from error
    if result.returncode != 0:
        raise Refusal(f"listing outbounds failed: xray exited {result.returncode}")
    try:
        payload = json.loads(result.stdout or "{}")
    except ValueError as error:
        # Never embed raw lso stdout in errors because it contains SOCKS5 passwords.
        raise Refusal("listing outbounds returned invalid JSON") from error
    items = payload.get("outbounds") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise Refusal("listing outbounds returned unexpected shape")
    outbounds: dict[str, dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        tag = item.get("tag")
        if not isinstance(tag, str) or not tag.startswith(HOME_OUTBOUND_PREFIX):
            continue
        proxy = item.get("proxySettings")
        server: dict[str, Any] = {}
        if isinstance(proxy, dict):
            if isinstance(proxy.get("server"), dict):
                server = proxy["server"]
            elif isinstance(proxy.get("servers"), list) and proxy["servers"] and isinstance(proxy["servers"][0], dict):
                server = proxy["servers"][0]
        user_obj = server.get("user") if isinstance(server.get("user"), dict) else {}
        account = user_obj.get("account") if isinstance(user_obj.get("account"), dict) else {}
        outbounds[tag] = {
            "host": server.get("address"),
            "port": server.get("port"),
            "username": account.get("username"),
            "password": account.get("password"),
        }
    return outbounds


def remove_home_outbound(binary: Path, commands: dict[str, str], address: str, tag: str) -> None:
    cmd = commands.get("remove_outbound")
    if not cmd:
        raise Refusal("removing outbound failed: rmo command unavailable")
    try:
        result = run_xray(binary, ["api", cmd, f"--server={address}", tag])
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refusal(f"removing outbound {tag} failed: {type(error).__name__}") from error
    if result.returncode != 0:
        raise Refusal(f"removing outbound {tag} failed: {api_error(result)}")


def _outbound_matches_spec(existing: dict[str, Any], spec: dict[str, Any]) -> bool:
    return (
        existing.get("host") == spec["host"]
        and existing.get("port") == spec["port"]
        and existing.get("username") == spec["username"]
        and existing.get("password") == spec["password"]
    )


def ensure_home_outbound(
    binary: Path, commands: dict[str, str], address: str, state_dir: Path,
    outbound: dict[str, Any], live_outbounds: dict[str, dict[str, Any]],
) -> None:
    """Install one per-tenant SOCKS outbound via `ado` inside `0700`/`0600` staging."""
    tag = home_outbound_tag(outbound["homeExitId"], outbound["bindingGeneration"])
    if tag in live_outbounds:
        if _outbound_matches_spec(live_outbounds[tag], outbound):
            return
        remove_home_outbound(binary, commands, address, tag)
        live_outbounds.pop(tag, None)
    cmd = commands.get("add_outbound")
    if not cmd:
        raise Refusal("adding outbound failed: ado command unavailable")
    snippet = {
        "outbounds": [{
            "tag": tag,
            "protocol": "socks",
            "settings": {
                "servers": [{
                    "address": outbound["host"],
                    "port": outbound["port"],
                    "users": [{
                        "user": outbound["username"],
                        "pass": outbound["password"],
                    }],
                }],
            },
        }],
    }
    try:
        with staged_json_file(state_dir, "tono-ado-", snippet) as json_path:
            result = run_xray(binary, ["api", cmd, f"--server={address}", str(json_path)])
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refusal(f"adding outbound {tag} failed: {type(error).__name__}") from error
    if result.returncode != 0:
        msg = api_error(result)
        if "existing tag found" in msg:
            refreshed = list_home_outbounds(binary, commands, address)
            if tag in refreshed and _outbound_matches_spec(refreshed[tag], outbound):
                live_outbounds[tag] = refreshed[tag]
                return
        # Never embed raw command stderr if it could carry config snippets.
        raise Refusal(f"adding outbound {tag} failed (exit {result.returncode})")
    live_outbounds[tag] = {
        "host": outbound["host"],
        "port": outbound["port"],
        "username": outbound["username"],
        "password": outbound["password"],
    }


def home_rule_tag(outbound_tag: str) -> str:
    pair = parse_home_outbound_tag(outbound_tag)
    if pair is None:
        raise Refusal(f"invalid home outbound tag {outbound_tag!r}")
    return f"tono-home-{pair[0]}-{pair[1]}"


def build_node_home_rules(outbound_to_users: dict[str, list[str]]) -> list[dict[str, Any]]:
    """Build exact replace-all Xray routing rules preserving fail-closed guards."""
    rules: list[dict[str, Any]] = [
        {
            "type": "field",
            "ruleTag": API_RULE_TAG,
            "inboundTag": [API_INBOUND_TAG],
            "outboundTag": API_TAG,
        },
        {
            "type": "field",
            "ruleTag": HOME_PRIVATE_CIDRS_RULE_TAG,
            "user": ["regexp:^h:"],
            "ip": list(PRIVATE_HOME_CIDRS),
            "outboundTag": HOME_BLACKHOLE_TAG,
        },
    ]
    for outbound_tag in sorted(outbound_to_users):
        users = sorted(set(outbound_to_users[outbound_tag]))
        if not users:
            continue
        rules.append({
            "type": "field",
            "ruleTag": home_rule_tag(outbound_tag),
            "user": users,
            "outboundTag": outbound_tag,
        })
    rules.append({
        "type": "field",
        "ruleTag": HOME_CATCHALL_RULE_TAG,
        "user": ["regexp:^h:"],
        "outboundTag": HOME_BLACKHOLE_TAG,
    })
    return rules


def replace_routing_rules(
    binary: Path, commands: dict[str, str], address: str, state_dir: Path,
    rules: list[dict[str, Any]],
) -> None:
    """Atomically replace the entire Xray routing table (`adrules` without `-append`)."""
    cmd = commands.get("add_rules")
    if not cmd:
        raise Refusal("replacing routing rules failed: adrules command unavailable")
    document = {"routing": {"rules": rules}}
    try:
        with staged_json_file(state_dir, "tono-adrules-", document) as json_path:
            result = run_xray(binary, ["api", cmd, f"--server={address}", str(json_path)])
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refusal(f"replacing routing rules failed: {type(error).__name__}") from error
    if result.returncode != 0:
        raise Refusal(f"replacing routing rules failed: {api_error(result)}")


def list_routing_rules(binary: Path, commands: dict[str, str], address: str) -> list[dict[str, Any]]:
    cmd = commands.get("list_rules")
    if not cmd:
        raise Refusal("listing routing rules failed: lsrules command unavailable")
    try:
        result = run_xray(binary, ["api", cmd, f"--server={address}"])
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refusal(f"listing routing rules failed: {type(error).__name__}") from error
    if result.returncode != 0:
        raise Refusal(f"listing routing rules failed: {api_error(result)}")
    try:
        payload = json.loads(result.stdout or "{}")
    except ValueError as error:
        raise Refusal("listing routing rules returned invalid JSON") from error
    rules = payload.get("rules") if isinstance(payload, dict) else None
    if not isinstance(rules, list):
        raise Refusal("listing routing rules returned unexpected shape")
    return [rule for rule in rules if isinstance(rule, dict)]


def verify_node_home_rules_and_routes(
    binary: Path, commands: dict[str, str], address: str, tag: str,
    rules: list[dict[str, Any]], outbound_to_users: dict[str, list[str]],
) -> None:
    """Confirm `lsrules` order matches AND `TestRoute` proves private-CIDR & tenant isolation."""
    observed = list_routing_rules(binary, commands, address)
    expected_pairs = [(r["ruleTag"], r["outboundTag"]) for r in rules]
    observed_pairs = [(r.get("ruleTag"), r.get("tag")) for r in observed]
    if observed_pairs != expected_pairs:
        raise Refusal(
            f"routing rules verification mismatch: expected {expected_pairs}, got {observed_pairs}"
        )
    try:
        unbound = grpc_test_route(
            address,
            inbound_tag_name=tag,
            user="h:unbound-probe:0:0",
            target_domain="canary-home.invalid",
            target_port=443,
        )
        if unbound.get("outbound_tag") != HOME_BLACKHOLE_TAG:
            raise Refusal(
                f"unbound h: TestRoute expected {HOME_BLACKHOLE_TAG}, got {unbound.get('outbound_tag')!r}"
            )
        sample_user = next(
            (users[0] for users in outbound_to_users.values() if users),
            "h:unbound-probe:0:0",
        )
        for private_ip in ("127.0.0.1", "10.0.0.1"):
            priv = grpc_test_route(
                address,
                inbound_tag_name=tag,
                user=sample_user,
                target_ip=private_ip,
                target_port=80,
            )
            if priv.get("outbound_tag") != HOME_BLACKHOLE_TAG:
                raise Refusal(
                    f"private IP {private_ip} TestRoute expected {HOME_BLACKHOLE_TAG}, got {priv.get('outbound_tag')!r}"
                )
        for outbound_tag in sorted(outbound_to_users):
            for h_label in sorted(set(outbound_to_users[outbound_tag])):
                routed = grpc_test_route(
                    address,
                    inbound_tag_name=tag,
                    user=h_label,
                    target_domain="canary-home.invalid",
                    target_port=443,
                )
                if routed.get("outbound_tag") != outbound_tag:
                    raise Refusal(
                        f"TestRoute for {h_label} expected {outbound_tag}, got {routed.get('outbound_tag')!r}"
                    )
    except (OSError, ValueError, struct.error) as error:
        raise Refusal(f"TestRoute RPC verification failed: {type(error).__name__}: {error}") from error


def fetch_roster(base: str, token: str) -> tuple[str, int, list[dict], bool, dict[str, int] | None]:
    request = urllib.request.Request(
        f"{base}/api/v1/home/exit-identities",
        headers=REQUEST_HEADERS,
        method="GET",
    )
    request.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        response = open_control_plane(request, timeout=20)
    except urllib.error.HTTPError as error:
        if is_node_disabled(error):
            raise NodeDisabled(
                "the control plane reports this exit node disabled",
                node_disabled_reason(error),
            ) from error
        raise
    with response as opened:
        raw = opened.read(MAX_ROSTER_BYTES + 1)
    if len(raw) > MAX_ROSTER_BYTES:
        # A prefix proves nothing about who is absent, so nothing is removed on
        # it; the round refuses loudly instead of failing to parse every time.
        raise Refusal(f"roster response exceeds {MAX_ROSTER_BYTES} bytes; nothing was applied")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except ValueError as error:
        raise Refusal(f"roster response is not JSON: {error}") from error
    if not isinstance(payload, dict):
        raise Refusal("roster response is not the documented shape")
    return parse_roster(payload)


class ParsedRoster(tuple):
    """5-tuple `(node_id, observed_at, roster, retire_shared_legacy, watermarks)`
    with optional scoped `home_identities`, `home_outbounds`, and cached `home_lease`."""

    home_identities: list[dict] | None
    home_outbounds: list[dict] | None
    home_lease: dict | None

    def __new__(
        cls,
        node_id: str,
        observed_at: int,
        roster: list[dict],
        retire_shared_legacy: bool,
        watermarks: dict[str, int] | None,
        *,
        home_identities: list[dict] | None = None,
        home_outbounds: list[dict] | None = None,
        home_lease: dict | None = None,
    ):
        obj = super().__new__(
            cls, (node_id, observed_at, roster, retire_shared_legacy, watermarks),
        )
        obj.home_identities = home_identities
        obj.home_outbounds = home_outbounds
        obj.home_lease = home_lease
        return obj


def _validate_home_outbounds(entries: Any) -> tuple[list[dict], dict[tuple[str, str], dict]]:
    if not isinstance(entries, list):
        raise Refusal("roster homeOutbounds is not a list")
    outbounds: list[dict] = []
    by_pair: dict[tuple[str, str], dict] = {}
    for entry in entries:
        if not isinstance(entry, dict):
            raise Refusal("roster homeOutbounds entry is not an object")
        home_exit_id = entry.get("homeExitId")
        binding_gen = entry.get("bindingGeneration")
        host = entry.get("host")
        port = entry.get("port")
        username = entry.get("username")
        password = entry.get("password")
        if not isinstance(home_exit_id, str) or not HOME_ID_PATTERN.fullmatch(home_exit_id):
            raise Refusal("roster homeOutbounds entry has an invalid homeExitId")
        if not isinstance(binding_gen, str) or not HOME_ID_PATTERN.fullmatch(binding_gen):
            raise Refusal("roster homeOutbounds entry has an invalid bindingGeneration")
        if (
            not isinstance(host, str)
            or not 1 <= len(host) <= 253
            or "/" in host
            or any(ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in host)
        ):
            raise Refusal(f"roster homeOutbounds entry {home_exit_id} has an invalid host")
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise Refusal(f"roster homeOutbounds entry {home_exit_id} has an invalid port")
        if not isinstance(username, str) or not 1 <= len(username) <= 255:
            raise Refusal(f"roster homeOutbounds entry {home_exit_id} has an empty or invalid username")
        if not isinstance(password, str) or not 1 <= len(password) <= 255:
            raise Refusal(f"roster homeOutbounds entry {home_exit_id} has an empty or invalid password")
        pair = (home_exit_id, binding_gen)
        if pair in by_pair:
            raise Refusal("roster homeOutbounds repeats a binding generation")
        normalized = {
            "homeExitId": home_exit_id,
            "bindingGeneration": binding_gen,
            "host": host,
            "port": port,
            "username": username,
            "password": password,
        }
        outbounds.append(normalized)
        by_pair[pair] = normalized
    return outbounds, by_pair


def _validate_home_identities(
    entries: Any,
    seen_uuids: set[str],
    outbound_by_pair: dict[tuple[str, str], dict] | None,
    watermarks: dict[str, int] | None,
    u_watermarks_by_user: dict[str, int],
) -> list[dict]:
    if not isinstance(entries, list):
        raise Refusal("roster homeIdentities is not a list")
    home_roster: list[dict] = []
    seen_labels: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise Refusal("home roster entry is not an object")
        user_id = entry.get("userId")
        device_id = entry.get("deviceId")
        client_uuid = entry.get("clientUUID")
        home_exit_id = entry.get("homeExitId")
        binding_gen = entry.get("bindingGeneration")
        if not isinstance(user_id, str) or not 1 <= len(user_id) <= 100:
            raise Refusal("home roster entry has an invalid userId")
        if not isinstance(device_id, str) or not 1 <= len(device_id) <= 100:
            raise Refusal("home roster entry has an invalid deviceId")
        if not isinstance(client_uuid, str) or not UUID_PATTERN.fullmatch(client_uuid):
            raise Refusal("home roster entry has an invalid clientUUID")
        if client_uuid in seen_uuids:
            raise Refusal("roster repeats an identity across cloud and residential entries")
        seen_uuids.add(client_uuid)
        if not isinstance(home_exit_id, str) or not HOME_ID_PATTERN.fullmatch(home_exit_id):
            raise Refusal("home roster entry has an invalid homeExitId")
        if not isinstance(binding_gen, str) or not HOME_ID_PATTERN.fullmatch(binding_gen):
            raise Refusal("home roster entry has an invalid bindingGeneration")
        if outbound_by_pair is not None and (home_exit_id, binding_gen) not in outbound_by_pair:
            raise Refusal(f"home roster entry references missing outbound {home_exit_id}:{binding_gen}")
        label = home_client_label(user_id, device_id, client_uuid)
        if label in seen_labels:
            raise Refusal("home roster repeats a client label")
        seen_labels.add(label)
        parsed: dict[str, Any] = {
            "userId": user_id,
            "deviceId": device_id,
            "clientUUID": client_uuid,
            "homeExitId": home_exit_id,
            "bindingGeneration": binding_gen,
        }
        if "sourceUsageBytes" in entry:
            wm = entry.get("sourceUsageBytes")
            if isinstance(wm, bool) or not isinstance(wm, int) or not 0 <= wm <= MAX_SAFE_INTEGER:
                raise Refusal("home roster entry has an invalid sourceUsageBytes")
            if watermarks is not None and wm != watermarks.get(user_id, 0):
                raise Refusal("roster sourceUsageWatermarks disagrees with a home identity")
            if user_id in u_watermarks_by_user and u_watermarks_by_user[user_id] != wm:
                raise Refusal("roster sourceUsageBytes disagrees between cloud and home entries")
            u_watermarks_by_user[user_id] = wm
            parsed["sourceUsageBytes"] = wm
        home_roster.append(parsed)
    return home_roster


def parse_roster(
    payload: dict, *, allow_cached_home_lease: bool = False,
) -> ParsedRoster:
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
        if not isinstance(client_uuid, str) or not UUID_PATTERN.fullmatch(client_uuid):
            raise Refusal("roster entry has an invalid clientUUID")
        device_id = entry.get("deviceId")
        if device_id is not None and (not isinstance(device_id, str) or not 1 <= len(device_id) <= 100):
            # Presence means this is a device-scoped credential. Treating a bad
            # value as absent silently downgrades it to the legacy u:<user>
            # label, where two devices can overwrite each other and the wrong
            # identity can remain installed.
            raise Refusal("roster entry has an invalid deviceId")
        parsed = {"userId": user_id, "clientUUID": client_uuid, "deviceId": device_id}
        if "sourceUsageBytes" in entry:
            watermark = entry.get("sourceUsageBytes")
            if (
                isinstance(watermark, bool)
                or not isinstance(watermark, int)
                or not 0 <= watermark <= MAX_SAFE_INTEGER
            ):
                raise Refusal("roster entry has an invalid sourceUsageBytes")
            parsed["sourceUsageBytes"] = watermark
        roster.append(parsed)
    u_watermarks_by_user: dict[str, int] = {}
    if roster and any("sourceUsageBytes" in entry for entry in roster):
        if any("sourceUsageBytes" not in entry for entry in roster):
            raise Refusal("roster sourceUsageBytes is present on only some identities")
        for entry in roster:
            previous = u_watermarks_by_user.get(entry["userId"])
            watermark = entry["sourceUsageBytes"]
            if previous is not None and previous != watermark:
                raise Refusal("roster sourceUsageBytes disagrees for one account")
            u_watermarks_by_user[entry["userId"]] = watermark
    seen_uuids = {entry["clientUUID"] for entry in roster}
    if len(seen_uuids) != len(roster):
        raise Refusal("roster repeats an identity, which would merge two accounts' counters")
    watermarks: dict[str, int] | None = None
    if "sourceUsageWatermarks" in payload:
        entries = payload["sourceUsageWatermarks"]
        if not isinstance(entries, list):
            raise Refusal("roster sourceUsageWatermarks is not a list")
        watermarks = {}
        for entry in entries:
            if not isinstance(entry, dict):
                raise Refusal("roster sourceUsageWatermarks entry is not an object")
            user_id = entry.get("userId")
            watermark = entry.get("sourceUsageBytes")
            if (not isinstance(user_id, str) or not 1 <= len(user_id) <= 100
                    or isinstance(watermark, bool) or not isinstance(watermark, int)
                    or not 0 <= watermark <= MAX_SAFE_INTEGER):
                raise Refusal("roster sourceUsageWatermarks entry is invalid")
            if user_id in watermarks:
                raise Refusal("roster sourceUsageWatermarks repeats an account")
            watermarks[user_id] = watermark
        for entry in roster:
            if ("sourceUsageBytes" in entry
                    and entry["sourceUsageBytes"] != watermarks.get(entry["userId"], 0)):
                raise Refusal("roster sourceUsageWatermarks disagrees with an identity")

    if allow_cached_home_lease and "homeOutbounds" in payload:
        raise Refusal("the saved roster must not store outbound credentials")
    if not allow_cached_home_lease and (("homeIdentities" in payload) != ("homeOutbounds" in payload)):
        raise Refusal("roster response must include both homeIdentities and homeOutbounds together")

    home_outbounds: list[dict] | None = None
    outbound_by_pair: dict[tuple[str, str], dict] | None = None
    if "homeOutbounds" in payload:
        home_outbounds, outbound_by_pair = _validate_home_outbounds(payload["homeOutbounds"])

    home_identities: list[dict] | None = None
    if "homeIdentities" in payload:
        home_identities = _validate_home_identities(
            payload["homeIdentities"],
            seen_uuids,
            outbound_by_pair,
            watermarks,
            u_watermarks_by_user,
        )

    return ParsedRoster(
        node_id,
        observed_at,
        roster,
        retire_shared_legacy,
        watermarks,
        home_identities=home_identities,
        home_outbounds=home_outbounds,
    )


def acknowledge_roster(
    base: str,
    token: str,
    observed_at: int,
    *,
    metering_protocol_version: int | None = None,
    node_home_capable: bool | None = None,
    node_home_xray_version: str | None = None,
    home_observed_at: int | None = None,
    drained_generations: list[dict[str, str]] | None = None,
) -> None:
    payload: dict[str, Any] = {"observedAt": observed_at}
    if metering_protocol_version is not None:
        payload["meteringProtocolVersion"] = metering_protocol_version
    if node_home_capable is not None:
        payload["nodeHomeCapable"] = node_home_capable
    if node_home_xray_version is not None:
        payload["nodeHomeXrayVersion"] = node_home_xray_version
    if home_observed_at is not None:
        payload["homeObservedAt"] = home_observed_at
    if drained_generations:
        payload["drainedGenerations"] = drained_generations[:MAX_DRAINED_GENERATIONS_PER_ACK]
    body = json.dumps(payload).encode("utf-8")
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
    except (urllib.error.URLError, OSError, http.client.HTTPException) as error:
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
    except (urllib.error.URLError, OSError, http.client.HTTPException) as error:
        raise Refusal(f"metering ack failed: {error}") from error


# Present only on the dict returned for a state file that does not exist yet.
# Every load site removes it before the first save. A file that actually
# contains the key is an older agent writing an unknown field, not evidence
# that the ledger was missing: only the absent-file branch sets it.
_LEDGER_MISSING = "_ledgerMissing"


def load_state(path: Path) -> dict:
    if not path.exists():
        return {
            "totals": {},
            "counterBaseline": {},
            "pendingReports": [],
            _LEDGER_MISSING: True,
        }
    with path.open("r", encoding="utf-8") as handle:
        state = json.load(handle)
    # Valid JSON that is not an object ([] or null) must be a refusal like any
    # other corruption, not an AttributeError that ends the round before any
    # client is removed.
    if not isinstance(state, dict):
        raise Refusal("state file is corrupt: not a JSON object")
    for key, kind in (("totals", dict), ("counterBaseline", dict), ("pendingReports", list)):
        if not isinstance(state.get(key), kind):
            raise Refusal(f"state file is corrupt: {key}")
    # Absent on a state file written before this agent recorded them, which is
    # not corruption — it is the case that has to remove nothing.
    for key, kind in (("installedClients", list), ("sourceId", str), ("startMarker", str),
                      ("lastReportObservedAt", int), ("stuckRemovals", dict),
                      ("xrayRestartAt", int), ("xrayRestartsUnconverged", int),
                      ("activeHomeGenerations", list), ("pendingDrainAcks", list)):
        if key in state and not isinstance(state[key], kind):
            raise Refusal(f"state file is corrupt: {key}")
    # Used as a set of labels before revocation; a non-string entry would crash it.
    if not all(isinstance(label, str) for label in state.get("installedClients", [])):
        raise Refusal("state file is corrupt: installedClients")
    for item in state.get("activeHomeGenerations", []):
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("homeExitId"), str)
            or not isinstance(item.get("bindingGeneration"), str)
        ):
            raise Refusal("state file is corrupt: activeHomeGenerations")
    for item in state.get("pendingDrainAcks", []):
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("homeExitId"), str)
            or not isinstance(item.get("retiredGeneration"), str)
        ):
            raise Refusal("state file is corrupt: pendingDrainAcks")
    last_report_at = state.get("lastReportObservedAt")
    if (
        isinstance(last_report_at, bool)
        or isinstance(last_report_at, int)
        and not 0 <= last_report_at <= MAX_SAFE_INTEGER
    ):
        raise Refusal("state file is corrupt: lastReportObservedAt")
    return state


def take_ledger_missing(state: dict) -> bool:
    """Whether this process invented the ledger because the file was absent."""
    return bool(state.pop(_LEDGER_MISSING, False))


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".new")
    # The ledger names every client and its usage: create it 0600 and narrow a
    # stale `.new` from a crashed run before any byte is written, never after.
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(temporary, flags, STATE_MODE)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        os.fchmod(handle.fileno(), STATE_MODE)
        json.dump(state, handle, sort_keys=True)
        # The rename below must not reach disk before these bytes do, or a
        # power loss leaves an empty ledger that refuses metering.
        handle.flush()
        os.fsync(handle.fileno())
    # Rename rather than write in place: a crash mid-write would otherwise leave
    # lifetime totals truncated, and truncated totals bill nobody for what they
    # already used.
    temporary.replace(path)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def attach_installed(error: Refusal, installed: set[str] | None) -> Refusal:
    """Keep a known label set on a refusal that would otherwise drop it."""
    if isinstance(installed, set):
        error.installed = installed
    return error


def refusal_installed(error: BaseException) -> set[str] | None:
    installed = getattr(error, "installed", None)
    return installed if isinstance(installed, set) else None


def persist_installed_inventory(path: Path, state: dict | None,
                                installed: set[str] | None) -> None:
    """Save clients this round already added or removed, and nothing else.

    A refusal after those mutations must not acknowledge the roster and must
    not advance usage totals. Without the label, a later round that cannot
    list the inbound has nothing to remove when the roster drops that client.
    None is not written: an empty list is a real inventory, and None means
    this round could not say what the inbound holds.
    """
    if state is None or not isinstance(installed, set):
        return
    labels = sorted(
        label for label in installed
        if isinstance(label, str)
        and (label == LEGACY_CLIENT_EMAIL or is_managed_label(label))
    )
    if state.get("installedClients") == labels:
        return
    save_state(path, {**state, "installedClients": labels})


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
        return (error.code in RETRYABLE_STATUSES or error.code >= 500
                or not worker_error_answer(error))
    return isinstance(error, (OSError, http.client.HTTPException))


def worker_error_answer(error: urllib.error.HTTPError) -> bool:
    """Whether an HTTP error carries the Worker's own JSON error envelope.

    Every control-plane rejection is `{"error": {"code": ...}}`. A 4xx without
    it, such as Cloudflare's browser-integrity block ("error code: 1010") or a
    WAF page, came from the edge in front of the Worker: the control plane has
    not said anything about this node, so the saved roster must survive it.
    """
    try:
        payload = json.loads(getattr(error, "tono_body", b"") or b"")
    except (ValueError, UnicodeDecodeError):
        return False
    detail = payload.get("error") if isinstance(payload, dict) else None
    return isinstance(detail, dict) and isinstance(detail.get("code"), str)


def discard_roster_cache(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError as error:
        raise Refusal(f"the saved roster could not be removed: {error}") from error


def node_disabled_answer(error: BaseException) -> bool:
    """Whether the control plane answered 403 EXIT_NODE_DISABLED.

    Reserved for PR #375, which keeps that bounded error body as `tono_body`
    and raises NodeDisabled from the HTTPError; either form counts. Without
    #375 no error carries the body and this is always false. A 403 that does
    carry the Worker's JSON error body is still an answer and discards the
    copy like any other; one without it is the edge (worker_error_answer).
    """
    for candidate in (error, error.__cause__):
        if not isinstance(candidate, urllib.error.HTTPError) or candidate.code != 403:
            continue
        try:
            payload = json.loads(getattr(candidate, "tono_body", b"") or b"")
        except (ValueError, UnicodeDecodeError):
            continue
        detail = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(detail, dict) and detail.get("code") == "EXIT_NODE_DISABLED":
            return True
    return False


def fetch_roster_or_discard_cache(base: str, token: str, cache: Path):
    """fetch_roster, deleting the saved roster on any answer from the control plane.

    The copy goes here, before any caller's handler runs. A disabled node
    withdraws every client; if its copy survived, the next network error would
    reinstall them all from it. For that answer a failed removal is reported
    but does not replace the error, so the withdrawal still runs.
    """
    try:
        return fetch_roster(base, token)
    except Exception as error:
        if node_disabled_answer(error):
            try:
                discard_roster_cache(cache)
            except Refusal as refusal:
                print(f"{refusal}; this disabled node still holds its saved roster",
                      file=sys.stderr)
            raise
        if not control_plane_unreachable(error):
            discard_roster_cache(cache)
        raise


class CachedRoster(tuple):
    """3-tuple `(roster, retire_shared_legacy, age)` plus optional `home_identities` & `home_lease`."""

    home_identities: list[dict] | None
    home_lease: dict | None

    def __new__(
        cls,
        roster: list[dict[str, str]],
        retire_shared_legacy: bool,
        age: int,
        *,
        home_identities: list[dict] | None = None,
        home_lease: dict | None = None,
    ):
        obj = super().__new__(cls, (roster, retire_shared_legacy, age))
        obj.home_identities = home_identities
        obj.home_lease = home_lease
        return obj


def save_roster_cache(path: Path, node_id: str, observed_at: int,
                      roster: list[dict[str, str]], retire_shared_legacy: bool,
                      watermarks: dict[str, int] | None = None,
                      *, home_identities: list[dict] | None = None,
                      start_marker: str | None = None) -> str | None:
    """Keep the roster just verified, for an Xray restart during an outage.

    The copy holds client credentials, so it is owner-only from creation and
    replaced atomically. Plaintext residential SOCKS5 credentials (`homeOutbounds`)
    are NEVER persisted here; residential `homeIdentities` carry only a short
    fail-closed lease bound to the current Xray process generation. If writing
    fails, the previous copy is removed: an older list may still name a revoked account.
    """
    saved_at = int(time.time())
    document: dict[str, Any] = {
        "version": ROSTER_CACHE_VERSION,
        "savedAt": saved_at,
        "nodeId": node_id,
        "observedAt": observed_at,
        "retireSharedLegacy": retire_shared_legacy,
        "identities": roster,
    }
    if watermarks is not None:
        document["sourceUsageWatermarks"] = [
            {"userId": user_id, "sourceUsageBytes": total}
            for user_id, total in watermarks.items()
        ]
    if home_identities:
        # Store non-secret h: identities under a short outage lease; never write homeOutbounds.
        document["homeIdentities"] = [
            {
                "userId": entry["userId"],
                "deviceId": entry["deviceId"],
                "clientUUID": entry["clientUUID"],
                "homeExitId": entry["homeExitId"],
                "bindingGeneration": entry["bindingGeneration"],
            }
            for entry in home_identities
        ]
        document["homeLease"] = {
            "savedAt": saved_at,
            "expiresAt": saved_at + MAX_HOME_OUTAGE_LEASE_SECONDS,
            "startMarker": start_marker,
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


def load_roster_cache(path: Path, source: str) -> CachedRoster:
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
    parsed = parse_roster(document, allow_cached_home_lease=True)
    node_id, _, roster, retire_shared_legacy, _ = parsed
    if node_id != source:
        raise Refusal("the saved roster belongs to another exit node")
    home_lease = document.get("homeLease")
    if home_lease is not None and not isinstance(home_lease, dict):
        raise Refusal("the saved roster has an invalid homeLease")
    return CachedRoster(
        roster,
        retire_shared_legacy,
        age,
        home_identities=parsed.home_identities,
        home_lease=home_lease,
    )


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
    try:
        result = run_xray(binary, ["api", command, f"--server={address}", f"--tag={tag}"])
    except (OSError, subprocess.TimeoutExpired):
        # A listing that could not run is unknown like a failed one; raising
        # here would skip revocation from the durable inventory entirely.
        return None
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
              retire_shared_legacy: bool = False,
              *,
              home_roster: list[dict] | None = None,
              preserve_home_labels: set[str] | None = None) -> tuple[int, int, set[str] | None]:
    """Add the accounts the roster names, remove the ones it does not.

    `listed` is what the inbound actually holds and `recorded` is what this agent
    remembers installing. Clients added over the management API never reach
    config.json, so a restart drops all of them: adds are attempted whenever the
    node cannot be asked, which is cheap because an account already present is
    success.

    Removal is the enforcement path, and a wrong one disconnects a paying
    customer. So it runs off what the node holds, or failing that off the labels
    this agent recorded installing, and never off counters. When neither is
    known, nothing is removed — except shared-legacy under an explicit
    retirement, which lives in the static config and so may be back after a
    restart even though no inventory still names it. Both `u:` and `h:` managed
    namespaces are revoked symmetrically; `preserve_home_labels` keeps already
    live `h:` clients only during a bounded valid outage lease.
    """
    removed = 0
    failures: list[str] = []
    # Our own clients whose revocation the API refused: the only input to the
    # opt-in Xray restart (shared-legacy comes back from the static config).
    failed_removals: set[str] = set()
    if retire_shared_legacy and listed is None:
        try:
            result = remove_inbound_user(
                binary, commands["remove_user"], address, tag, LEGACY_CLIENT_EMAIL,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            failures.append(f"removing {LEGACY_CLIENT_EMAIL} failed: {type(error).__name__}")
        else:
            if not removal_succeeded(result, LEGACY_CLIENT_EMAIL, commands["remove_user"]):
                # Like every other removal: reported with the rest, never a reason
                # to skip the revocations that follow.
                failures.append(f"removing {LEGACY_CLIENT_EMAIL} failed: {api_error(result)}")
            else:
                if result.returncode == 0 and (
                    commands["remove_user"] != "rmu"
                    or _total_at_least_one(_output_lines(result), "Removed")
                ):
                    # An already-absent client is not counted as a removal.
                    removed += 1
                if recorded is not None:
                    recorded = recorded - {LEGACY_CLIENT_EMAIL}
    wanted = {
        client_label(entry["userId"], entry.get("deviceId"), entry["clientUUID"]): entry["clientUUID"]
        for entry in roster
    }
    if home_roster:
        for entry in home_roster:
            wanted[home_client_label(entry["userId"], entry["deviceId"], entry["clientUUID"])] = entry["clientUUID"]
    keep_existing = set(wanted) | (preserve_home_labels or set())
    # A verified empty roster is the enforcement result after the final active
    # account expires, is disabled, or reaches quota. It must remove this
    # agent's `u:` and `h:` clients or those accounts keep connecting forever.
    if not keep_existing and listed is None and recorded is None:
        if failures:
            raise PartialReconcile("; ".join(failures))
        # A confirmed shared-legacy removal above still counts.
        return 0, removed, None
    installed = listed if listed is not None else recorded
    known_installed = None if installed is None else {
        label for label in installed
        if label == LEGACY_CLIENT_EMAIL or is_managed_label(label)
    }
    if installed is None:
        print("this exit cannot say which clients it holds; removed nothing")
    else:
        for label in sorted(installed - keep_existing):
            # Only this agent's own namespaces (`u:`, `h:`) are candidates,
            # except when explicitly retiring the shared-legacy client.
            if label == LEGACY_CLIENT_EMAIL:
                if not retire_shared_legacy:
                    continue
            elif not is_managed_label(label):
                continue
            try:
                result = remove_inbound_user(binary, commands["remove_user"], address, tag, label)
            except (OSError, subprocess.TimeoutExpired) as error:
                failures.append(f"removing {label} failed: {type(error).__name__}")
                failed_removals.add(label)
                continue
            if not removal_succeeded(result, label, commands["remove_user"]):
                # One failure must not leave every later revocation in place.
                failures.append(f"removing {label} failed: {api_error(result)}")
                failed_removals.add(label)
                continue
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
        try:
            result = add_inbound_user(
                binary, commands["add_user"], address, tag, label, client_uuid,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            # A timed-out RPC may already have installed the roster-issued label.
            # Remember it for later removal without claiming this round converged.
            if known_installed is not None:
                known_installed.add(label)
            failures.append(f"adding {label} failed: {type(error).__name__}")
            if isinstance(error, subprocess.TimeoutExpired):
                # A wedged API answers every add the same way, 30 s each, while
                # this round holds the lock. Revocations already ran above; the
                # remaining adds wait for the next round, which this one refuses.
                failures.append("remaining adds skipped after an API timeout")
                break
            continue
        # Already-present is success, not failure: two agents on one timer, or a
        # retry after a lost response, must not turn into an error loop. It is
        # not an addition either, or every round would report the whole roster.
        # Xray 26 `adu` prints its per-user result on stdout and exits 0 even
        # when the add failed; the legacy commands keep the exit-code rule.
        if commands["add_user"] == "adu":
            outcome = addition_outcome(result, label)
        else:
            outcome = ("present" if _one_line(label) and _legacy_user_line(
                           _output_lines(result), label, "already exists")
                       else "failed" if result.returncode != 0 else "added")
        if outcome == "failed":
            failures.append(f"adding {label} failed: {api_error(result)}")
            continue
        if outcome == "added":
            added += 1
        if known_installed is not None:
            known_installed.add(label)
    if failures:
        # Successful adds and removals already changed the inbound. The set has
        # to leave with the error, or the caller keeps the previous inventory
        # and a later unlistable round cannot revoke the client just installed.
        error = attach_installed(PartialReconcile("; ".join(failures)), known_installed)
        error.failed_removals = failed_removals
        raise error
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
    # roster must not roll a total backwards. A restart resets even an absent
    # account's baseline, or its later first reading would forgive old bytes.
    for label, carried in state["totals"].items():
        totals.setdefault(label, int(carried))
        baseline.setdefault(label, 0 if restarted else int(state["counterBaseline"].get(label, 0)))
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


def source_watermarks(roster: list[dict]) -> dict[str, int] | None:
    """Per-account server watermark from a parsed roster, or None if it has none.

    Compatibility fallback for a server without the independent recovery set.
    Its identity-only fields cannot recover inactive accounts' old counters.
    """
    if not roster:
        return {}
    if any("sourceUsageBytes" not in entry for entry in roster):
        return None
    return {entry["userId"]: int(entry["sourceUsageBytes"]) for entry in roster}


def adopt_source_watermarks(
    label_totals: dict[str, int],
    watermarks: dict[str, int] | None,
    *,
    ledger_missing: bool,
) -> dict[str, int]:
    """Stop a lost local ledger from being posted as a fresh lifetime.

    `lifetime_totals` has already folded this reading and pointed each baseline
    at the current raw counter. A missing state file has no carried total, so
    that fold is the raw counter itself. The control plane adds a reported
    total that is below its watermark on top of the watermark. Posting the raw
    counter therefore bills it twice.

    When the roster names a higher watermark, one of the account's labels keeps
    that watermark and the others stay at zero. The baselines stay on the raw
    reading, so the next round adds only bytes measured after this one. When
    the roster does not name watermarks, a missing ledger publishes nothing:
    the baselines still advance, and a later roster that does name the
    watermark can adopt it before any of those bytes are reported.
    """
    if watermarks is None:
        if ledger_missing:
            return {label: 0 for label in label_totals}
        return label_totals
    totals = dict(label_totals)
    user_totals = aggregate_user_totals(totals)
    for user_id, watermark in watermarks.items():
        if watermark <= user_totals.get(user_id, 0):
            continue
        labels = sorted(label for label in totals if attributed_user(label) == user_id)
        if not labels:
            # Accounting-only carry after a complete empty counter observation;
            # it never enters the roster or installed-client inventory.
            totals[client_label(user_id)] = watermark
            continue
        for index, label in enumerate(labels):
            totals[label] = watermark if index == 0 else 0
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
        except (OSError, http.client.HTTPException) as error:
            # A truncated or garbled answer is a transport failure: resending
            # the same reportIds counts nothing twice.
            failure = str(error) or type(error).__name__
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


class ReconcileResult(tuple):
    """5-tuple `(added, removed, installed, counters, settled_marker)` carrying
    reconciled node-home generations and drained generations."""

    active_home_generations: list[dict[str, str]]
    drained_generations: list[dict[str, str]]

    def __new__(
        cls,
        added: int,
        removed: int,
        installed: set[str] | None,
        counters: dict[str, int],
        settled_marker: str | None,
        *,
        active_home_generations: list[dict[str, str]] | None = None,
        drained_generations: list[dict[str, str]] | None = None,
    ):
        obj = super().__new__(cls, (added, removed, installed, counters, settled_marker))
        obj.active_home_generations = active_home_generations or []
        obj.drained_generations = drained_generations or []
        return obj


def _merge_drain_acks(
    existing: list[dict[str, str]] | None,
    newly_drained: list[dict[str, str]],
) -> list[dict[str, str]]:
    seen: set[tuple[str, str]] = set()
    merged: list[dict[str, str]] = []
    for item in [*(existing or []), *newly_drained]:
        if not isinstance(item, dict):
            continue
        hid = item.get("homeExitId")
        gen = item.get("retiredGeneration")
        if isinstance(hid, str) and isinstance(gen, str) and (hid, gen) not in seen:
            seen.add((hid, gen))
            merged.append({"homeExitId": hid, "retiredGeneration": gen})
    return merged


def _remove_home_labels_subset(
    binary: Path, commands: dict[str, str], address: str, tag: str,
    labels: list[str], known_installed: set[str] | None,
) -> tuple[int, list[str], set[str]]:
    removed = 0
    failures: list[str] = []
    failed_labels: set[str] = set()
    for label in labels:
        try:
            result = remove_inbound_user(binary, commands["remove_user"], address, tag, label)
        except (OSError, subprocess.TimeoutExpired) as error:
            failures.append(f"removing {label} failed: {type(error).__name__}")
            failed_labels.add(label)
            continue
        if not removal_succeeded(result, label, commands["remove_user"]):
            failures.append(f"removing {label} failed: {api_error(result)}")
            failed_labels.add(label)
            continue
        if known_installed is not None:
            known_installed.discard(label)
        removed += 1
    return removed, failures, failed_labels


def _drain_unused_home_outbounds(
    binary: Path, commands: dict[str, str], address: str,
    live_outbounds: dict[str, dict[str, Any]],
    still_needed_tags: set[str],
    previous_generations: list[dict[str, str]] | None,
) -> tuple[list[dict[str, str]], list[str]]:
    candidate_tags = set(live_outbounds)
    for item in previous_generations or []:
        if isinstance(item, dict):
            hid = item.get("homeExitId")
            gen = item.get("bindingGeneration")
            if isinstance(hid, str) and isinstance(gen, str):
                candidate_tags.add(home_outbound_tag(hid, gen))
    removable = sorted(candidate_tags - still_needed_tags)
    if not removable:
        return [], []
    failures: list[str] = []
    for ob_tag in removable:
        try:
            remove_home_outbound(binary, commands, address, ob_tag)
        except Refusal as error:
            failures.append(str(error))
    try:
        remaining = list_home_outbounds(binary, commands, address)
    except Refusal as error:
        failures.append(str(error))
        remaining = live_outbounds
    drained: list[dict[str, str]] = []
    for ob_tag in removable:
        if ob_tag in remaining:
            continue
        pair = parse_home_outbound_tag(ob_tag)
        if pair is not None:
            drained.append({"homeExitId": pair[0], "retiredGeneration": pair[1]})
    return drained, failures


def _sync_node_home_round(
    binary: Path,
    commands: dict[str, str],
    address: str,
    tag: str,
    state_dir: Path,
    roster: list[dict[str, str]],
    listed: set[str] | None,
    recorded: set[str] | None,
    retire_shared_legacy: bool,
    home_identities: list[dict],
    home_outbounds: list[dict],
    previous_generations: list[dict[str, str]] | None,
) -> tuple[int, int, set[str] | None, list[dict[str, str]], list[dict[str, str]]]:
    """Execute strict RFC §4.3 add/remove ordering for `h:` identities and `home:*` outbounds."""
    outbound_specs = {
        home_outbound_tag(item["homeExitId"], item["bindingGeneration"]): item
        for item in home_outbounds
    }
    desired_home_by_label: dict[str, dict] = {}
    for entry in home_identities:
        lbl = home_client_label(entry["userId"], entry["deviceId"], entry["clientUUID"])
        desired_home_by_label[lbl] = entry

    known_set = listed if listed is not None else recorded
    known_installed = None if known_set is None else {
        lbl for lbl in known_set if lbl == LEGACY_CLIENT_EMAIL or is_managed_label(lbl)
    }

    # Step 1 (Remove): rmu stale h: labels BEFORE replacing rules or rmo.
    stale_h = sorted(
        lbl for lbl in (known_set or set())
        if lbl.startswith(HOME_LABEL_PREFIX) and lbl not in desired_home_by_label
    )
    pre_removed, failures, failed_removals = _remove_home_labels_subset(
        binary, commands, address, tag, stale_h, known_installed,
    )

    # Step 2 (Add): ensure missing home:* outbounds via ado in 0700/0600 staging.
    live_outbounds = list_home_outbounds(binary, commands, address)
    failed_outbound_tags: set[str] = set()
    for ob_tag in sorted(outbound_specs):
        try:
            ensure_home_outbound(binary, commands, address, state_dir, outbound_specs[ob_tag], live_outbounds)
        except Refusal as error:
            failures.append(str(error))
            failed_outbound_tags.add(ob_tag)

    admissible_home: list[dict] = []
    admissible_tags: set[str] = set()
    outbound_to_users: dict[str, list[str]] = {}
    for lbl, entry in sorted(desired_home_by_label.items()):
        ob_tag = home_outbound_tag(entry["homeExitId"], entry["bindingGeneration"])
        if ob_tag in failed_outbound_tags or ob_tag not in live_outbounds:
            continue
        admissible_home.append(entry)
        outbound_to_users.setdefault(ob_tag, []).append(lbl)
        admissible_tags.add(ob_tag)

    # Step 3 & 4 (Add / Remove step 2): atomic full-table adrules replace-all + TestRoute verify.
    rules = build_node_home_rules(outbound_to_users)
    routes_verified = False
    try:
        replace_routing_rules(binary, commands, address, state_dir, rules)
        verify_node_home_rules_and_routes(binary, commands, address, tag, rules, outbound_to_users)
        routes_verified = True
    except Refusal as error:
        failures.append(str(error))

    if not routes_verified:
        # Fail closed: force 3-rule static blackhole list if possible and do NOT admit any h: identities.
        try:
            replace_routing_rules(
                binary, commands, address, state_dir, build_node_home_rules({}),
            )
        except Refusal as error:
            failures.append(str(error))
        admissible_home = []
        admissible_tags = set()

    # Step 5 (Add): reconcile u: + route-verified h: identities via adu/rmu.
    reconcile_err: PartialReconcile | None = None
    added = 0
    rec_removed = 0
    try:
        added, rec_removed, installed_after = reconcile(
            binary,
            commands,
            address,
            tag,
            roster,
            listed - (set(stale_h) - failed_removals) if listed is not None else None,
            known_installed,
            retire_shared_legacy=retire_shared_legacy,
            home_roster=admissible_home,
        )
    except PartialReconcile as partial:
        reconcile_err = partial
        installed_after = refusal_installed(partial)
        failed_removals |= getattr(partial, "failed_removals", set())
        failures.append(str(partial))

    # Step 6 (Remove step 3): rmo orphan home:* outbounds once zero active h: clients reference them.
    # If any h: removal failed, withhold rmo and drain ACK for previous generations conservatively.
    still_needed_tags = set(admissible_tags)
    has_failed_home_removal = any(lbl.startswith(HOME_LABEL_PREFIX) for lbl in failed_removals)
    if has_failed_home_removal:
        for item in previous_generations or []:
            hid = item.get("homeExitId")
            gen = item.get("bindingGeneration")
            if isinstance(hid, str) and isinstance(gen, str):
                still_needed_tags.add(home_outbound_tag(hid, gen))
    live_outbounds_now = list_home_outbounds(binary, commands, address)
    if not routes_verified or listed is None:
        drained, drain_failures = [], []
        if has_failed_home_removal or not routes_verified:
            for item in previous_generations or []:
                hid = item.get("homeExitId")
                gen = item.get("bindingGeneration")
                if isinstance(hid, str) and isinstance(gen, str):
                    still_needed_tags.add(home_outbound_tag(hid, gen))
    else:
        drained, drain_failures = _drain_unused_home_outbounds(
            binary, commands, address, live_outbounds_now, still_needed_tags, previous_generations,
        )
        failures.extend(drain_failures)

    active_gens = [
        {"homeExitId": item["homeExitId"], "bindingGeneration": item["bindingGeneration"]}
        for ob_tag, item in sorted(outbound_specs.items())
        if ob_tag in still_needed_tags and ob_tag in live_outbounds_now
    ]

    if failures:
        combined = attach_installed(PartialReconcile("; ".join(failures)), installed_after)
        combined.failed_removals = failed_removals | (getattr(reconcile_err, "failed_removals", set()))
        combined.active_home_generations = active_gens
        combined.drained_generations = drained
        raise combined
    return added, pre_removed + rec_removed, installed_after, active_gens, drained


def reconcile_and_read_stable(
    binary: Path,
    commands: dict[str, str],
    address: str,
    tag: str,
    roster: list[dict[str, str]] | None,
    recorded: set[str] | None,
    retire_shared_legacy: bool = False,
    *,
    home_identities: list[dict] | None = None,
    home_outbounds: list[dict] | None = None,
    preserve_home_labels: set[str] | None = None,
    node_home_capable: bool = False,
    state_dir: Path | None = None,
    previous_home_generations: list[dict[str, str]] | None = None,
) -> ReconcileResult:
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
        active_gens: list[dict[str, str]] = []
        drained_gens: list[dict[str, str]] = []
        if roster is None:
            added, removed, installed = 0, 0, None
        elif node_home_capable and home_outbounds is not None:
            listed = installed_clients(binary, commands, address, tag)
            resolved_dir = state_dir or state_path().parent
            added, removed, installed, active_gens, drained_gens = _sync_node_home_round(
                binary,
                commands,
                address,
                tag,
                resolved_dir,
                roster,
                listed,
                recorded,
                retire_shared_legacy,
                home_identities or [],
                home_outbounds,
                previous_home_generations,
            )
        else:
            listed = installed_clients(binary, commands, address, tag)
            if preserve_home_labels:
                added, removed, installed = reconcile(
                    binary, commands, address, tag, roster, listed, recorded,
                    retire_shared_legacy=retire_shared_legacy,
                    preserve_home_labels=preserve_home_labels,
                )
            else:
                added, removed, installed = reconcile(
                    binary, commands, address, tag, roster, listed, recorded,
                    retire_shared_legacy=retire_shared_legacy,
                )
        if "stats_query" not in commands:
            err = attach_installed(
                Refusal(
                    "clients were reconciled, but this xray offers no stats command "
                    "(tried statsquery, stats); usage cannot be metered"
                ),
                installed,
            )
            err.active_home_generations = active_gens
            err.drained_generations = drained_gens
            raise err
        try:
            counters = read_counters(binary, commands["stats_query"], address)
        except (Refusal, OSError, subprocess.TimeoutExpired) as error:
            if isinstance(error, Refusal):
                attach_installed(error, installed)
                error.active_home_generations = active_gens
                error.drained_generations = drained_gens
                raise
            err = attach_installed(
                Refusal(f"reading counters failed: {type(error).__name__}"), installed,
            )
            err.active_home_generations = active_gens
            err.drained_generations = drained_gens
            raise err from error
        marker_after = xray_start_marker(binary)
        if marker_before and marker_after and marker_before != marker_after:
            if attempt == 0:
                print("xray restarted during reconciliation; retrying against the new process")
                continue
            raise Refusal("xray kept restarting while clients and counters were reconciled")
        # The marker after the counter read is the only one known to still
        # describe that reading. If it is unavailable, forget the old marker so
        # a later process is not compared with stale evidence and folded twice.
        return ReconcileResult(
            added,
            removed,
            installed,
            counters,
            marker_after,
            active_home_generations=active_gens,
            drained_generations=drained_gens,
        )
    raise AssertionError("bounded xray reconciliation loop did not return")


def persist_shared_legacy_retirement(binary: Path, config: Path) -> bool:
    """Remove shared-legacy from the static Xray config so a restart cannot revive it.

    Written beside the original with its owner and mode, checked by the
    installed xray, then renamed into place; a failure leaves the old file and
    is a refusal, never a silent success. Returns whether the file changed.
    """
    try:
        info = config.stat()
        document = json.loads(config.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise Refusal(f"cannot read {config} to retire {LEGACY_CLIENT_EMAIL}: {error}") from error
    changed = False
    for inbound in document.get("inbounds", []) if isinstance(document, dict) else []:
        if not isinstance(inbound, dict) or inbound.get("protocol") != "vless":
            continue
        settings = inbound.get("settings")
        clients = settings.get("clients") if isinstance(settings, dict) else None
        if not isinstance(clients, list):
            continue
        kept = [c for c in clients
                if not (isinstance(c, dict) and c.get("email") == LEGACY_CLIENT_EMAIL)]
        if len(kept) != len(clients):
            settings["clients"] = kept
            changed = True
    if not changed:
        return False
    temporary: str | None = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".config-", suffix=".json",
                                                 dir=config.parent)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            json.dump(document, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        checked = run_xray(binary, ["run", "-test", "-config", temporary])
        if checked.returncode != 0:
            raise Refusal(
                f"xray rejected {config} without {LEGACY_CLIENT_EMAIL}: "
                f"{(checked.stderr or checked.stdout or '').strip() or checked.returncode}"
            )
        os.replace(temporary, config)
        temporary = None
        directory_fd = os.open(config.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except (OSError, subprocess.TimeoutExpired) as error:
        raise Refusal(f"cannot persist {LEGACY_CLIENT_EMAIL} retirement to {config}: {error}") from error
    finally:
        if temporary is not None:
            os.unlink(temporary)
    print(f"removed {LEGACY_CLIENT_EMAIL} from {config}")
    return True


def sync_hy2_roster(roster: list[dict[str, str]]) -> bool:
    """Replace an installed hy2 checker's list from this verified roster only.

    No hy2 directory means a VLESS-only node, which is unchanged. An installed
    but broken/read-only path is an error, never a successful reconciliation.
    Empty is a valid revocation result, not permission to retain static users.
    Caller holds agent_run_lock and has verified the roster's node identity.
    """
    for entry in roster:
        if (
            not isinstance(entry, dict)
            or "homeExitId" in entry
            or "bindingGeneration" in entry
            or entry.get("kind") == "home"
            or entry.get("namespace") == "h"
        ):
            raise Refusal("hy2 roster must never receive residential home identities")
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



def withdraw_disabled_node(binary: Path, commands: dict[str, str], address: str, tag: str,
                           recorded: set[str] | None,
                           *, state_dir: Path | None = None) -> tuple[int, set[str] | None]:
    """Fail closed after the control plane says this node is disabled or retired.

    The roster it last served still names every account, including ones revoked,
    expired or over quota since. Keeping them installed would leave revocation
    unenforced on a node nobody meters. Remove every client in this agent's
    namespace plus shared-legacy and empty hy2; hand-added clients stay, as in a
    normal reconcile. Returns the removal count and the remaining inventory, or
    None when the node could not say what it holds.
    """
    failures: list[str] = []
    try:
        sync_hy2_roster([])
    except Refusal as error:
        failures.append(str(error))
    except OSError as error:
        # As in a normal round: a hy2 filesystem failure must not skip the Xray withdrawal.
        failures.append(f"hy2 roster not withdrawn: {error}")
    listed = installed_clients(binary, commands, address, tag)
    inventory = listed if listed is not None else recorded
    # shared-legacy lives in the static config and is never recorded, so it is
    # always a candidate; "not found" counts as removed.
    candidates = set(inventory or ()) | {LEGACY_CLIENT_EMAIL}
    try:
        _, removed, remaining = reconcile(
            binary, commands, address, tag, [], None, candidates, retire_shared_legacy=True,
        )
    except Refusal as error:
        failures.append(str(error))
        removed, remaining = 0, None
    if node_home_commands_present(commands):
        resolved_dir = state_dir or state_path().parent
        try:
            live_outbounds = list_home_outbounds(binary, commands, address)
        except Refusal as error:
            live_outbounds = {}
            if config_has_node_home_topology(xray_config_path(), tag)[0]:
                failures.append(str(error))
        if live_outbounds or config_has_node_home_topology(xray_config_path(), tag)[0]:
            try:
                replace_routing_rules(
                    binary, commands, address, resolved_dir, build_node_home_rules({}),
                )
            except Refusal as error:
                failures.append(str(error))
            for ob_tag in sorted(live_outbounds):
                try:
                    remove_home_outbound(binary, commands, address, ob_tag)
                except Refusal as error:
                    failures.append(str(error))
    if failures:
        raise Refusal("disabled exit node could not withdraw every client: " + "; ".join(failures))
    return removed, remaining if inventory is not None else None


def control_plane_said(disabled: NodeDisabled) -> str:
    """The control plane's own reason as a refusal suffix: a disabled node and a
    token superseded by a rotation (#1296) share the code but not the cure."""
    return f"; control plane said: {disabled.reason}" if disabled.reason else ""


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
    try:
        node_id, observed_at, roster, _, _ = fetch_roster(base, token)
    except NodeDisabled as disabled:
        sync_hy2_roster([])
        raise Refusal(
            "the control plane reports this exit node disabled; hy2 allowlist emptied"
            + control_plane_said(disabled)
        )
    if node_id != expected:
        raise Refusal("hy2 roster node identity does not match TONO_SOURCE_ID")
    if not sync_hy2_roster(roster):
        raise Refusal("hy2-only sync requires an installed auth checker")
    print(f"hy2 roster applied: observedAt={observed_at}, identities={len(roster)}; no node-wide ACK or usage report")


def keep_usage_locally(path: Path, state: dict, installed: set[str] | None,
                       counters: dict[str, int], settled_marker: str | None,
                       *, ledger_missing: bool = False) -> None:
    """Fold one counter reading into the durable totals without reporting it.

    For rounds that must not report or acknowledge: the growth waits in the
    totals for the next round that reaches the control plane, so a later Xray
    restart or stop cannot forgive it.
    """
    source_id(state)
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
    # No roster clock and no watermark during an outage. A missing file must
    # not become a lifetime equal to the raw counter; the next round that
    # reaches the control plane adopts the watermark or reports only growth.
    if ledger_missing:
        totals = {label: 0 for label in totals}
    state["totals"] = {label: int(value) for label, value in totals.items()}
    if settled_marker:
        state["startMarker"] = settled_marker
    else:
        state.pop("startMarker", None)
    save_state(path, state)


def refuse_keeping_usage(error: Exception, path: Path, state: dict, installed: set[str] | None,
                         counters: dict[str, int], settled_marker: str | None,
                         *, ledger_missing: bool) -> None:
    """Raise `error` after folding this round's counter reading into the totals.

    For refusals that come after the counters were read. Without the fold the
    reading is thrown away; if Xray restarts before the next round folds, the
    restart resets the counters and every account's growth since the last fold
    is never billed. Nothing is reported or acknowledged here.

    A ledger that is still missing from disk stays missing: the next round that
    completes adopts the roster's watermark, which a zero-total fold written
    now would skip. Once this round has written the file, the zero-total fold
    is what stops the next round from posting the raw counter as a lifetime.
    """
    if ledger_missing and not path.exists():
        persist_installed_inventory(path, state, installed)
        raise error
    inventory_base = dict(state)
    try:
        keep_usage_locally(
            path, state, installed, counters, settled_marker, ledger_missing=ledger_missing,
        )
    except (Refusal, OSError) as keep_error:
        # source_id can refuse before keep_usage_locally writes. The clients
        # already reconciled still have to be remembered.
        persist_installed_inventory(path, inventory_base, installed)
        raise Refusal(f"{error}; usage not kept: {keep_error}") from error
    raise error


def _evaluate_home_outage_lease(
    binary: Path, commands: dict[str, str], address: str, tag: str,
    cached_home: list[dict] | None, home_lease: dict | None,
) -> tuple[bool, set[str], bool]:
    """Check whether cached `h:` identities remain inside their bounded outage lease."""
    if not node_home_commands_present(commands):
        return False, set(), False
    capable, _, _ = detect_node_home_capability(binary, xray_config_path(), commands, tag)
    if not cached_home:
        return capable, set(), capable
    current_marker = xray_start_marker(binary)
    now_sec = int(time.time())
    saved_at = home_lease.get("savedAt") if isinstance(home_lease, dict) else None
    expires_at = home_lease.get("expiresAt") if isinstance(home_lease, dict) else None
    lease_marker = home_lease.get("startMarker") if isinstance(home_lease, dict) else None
    lease_valid = bool(
        capable
        and isinstance(saved_at, int) and not isinstance(saved_at, bool)
        and isinstance(expires_at, int) and not isinstance(expires_at, bool)
        and saved_at <= now_sec <= min(expires_at, saved_at + MAX_HOME_OUTAGE_LEASE_SECONDS)
        and isinstance(lease_marker, str) and lease_marker
        and current_marker == lease_marker
    )
    if not lease_valid:
        return capable, set(), True
    try:
        live_outbounds = list_home_outbounds(binary, commands, address)
    except Refusal:
        return capable, set(), True
    preserved = {
        home_client_label(entry["userId"], entry["deviceId"], entry["clientUUID"])
        for entry in cached_home
        if home_outbound_tag(entry["homeExitId"], entry["bindingGeneration"]) in live_outbounds
    }
    return capable, preserved, False


def _teardown_home_rules_and_outbounds(
    binary: Path, commands: dict[str, str], address: str, state_dir: Path,
    previous_generations: list[dict[str, str]] | None,
) -> tuple[list[dict[str, str]], list[str]]:
    """Fail-closed cleanup of dynamic rules & `home:*` outbounds after `h:` removal."""
    failures: list[str] = []
    try:
        replace_routing_rules(binary, commands, address, state_dir, build_node_home_rules({}))
    except Refusal as error:
        failures.append(str(error))
    try:
        live_outbounds = list_home_outbounds(binary, commands, address)
    except Refusal as error:
        failures.append(str(error))
        return [], failures
    drained, drain_failures = _drain_unused_home_outbounds(
        binary, commands, address, live_outbounds, set(), previous_generations,
    )
    failures.extend(drain_failures)
    return drained, failures


def run_outage_round(path: Path, configured: str, binary: Path,
                     commands: dict[str, str], address: str, tag: str,
                     override: bool | None, failure: BaseException) -> None:
    """Serve and meter the last verified roster while the control plane is down.

    Xray loses every API-added client when it restarts, so without this a
    restart during an outage locks out every account on the node until the
    control plane returns. Cloud `u:` identities retain the 24h outage cache;
    residential `h:` identities enforce a bounded 300s lease tied to the live
    Xray process and fail closed immediately upon expiry or Xray restart.

    Counters are folded either way, so a restart cannot forgive the usage
    before it. Nothing is acknowledged, and the round always exits non-zero.
    """
    # As in a reachable round, the roster is applied before any metering-side
    # check: a damaged state file must not decide which clients are installed.
    try:
        state = load_state(path)
        state_error: Exception | None = None
    except (Refusal, ValueError, OSError) as error:
        state, state_error = None, error
    ledger_missing = take_ledger_missing(state) if state is not None else False
    cached_home: list[dict] | None = None
    home_lease: dict | None = None
    try:
        cached = load_roster_cache(roster_cache_path(path), configured)
        roster, server_retire, age = cached
        cached_home = getattr(cached, "home_identities", None)
        home_lease = getattr(cached, "home_lease", None)
    except Refusal as refusal:
        roster, server_retire, age, unusable = None, False, 0, refusal
    retire_shared_legacy = server_retire if override is None else override
    remembered = state.get("installedClients") if state else None
    recorded_set = set(remembered) if isinstance(remembered, list) else None
    node_home_tools, preserve_home_labels, should_teardown_home = _evaluate_home_outage_lease(
        binary, commands, address, tag, cached_home, home_lease,
    )
    try:
        if preserve_home_labels and roster is not None:
            result = reconcile_and_read_stable(
                binary, commands, address, tag, roster, recorded_set,
                retire_shared_legacy=retire_shared_legacy,
                preserve_home_labels=preserve_home_labels,
            )
        else:
            result = reconcile_and_read_stable(
                binary, commands, address, tag, roster, recorded_set,
                retire_shared_legacy=retire_shared_legacy,
            )
        added, removed, installed, counters, settled_marker = result
    except Refusal as error:
        persist_installed_inventory(path, state, refusal_installed(error))
        raise
    home_teardown_note = ""
    if should_teardown_home and node_home_commands_present(commands):
        previous_gens = state.get("activeHomeGenerations") if isinstance(state, dict) else None
        if node_home_tools or previous_gens:
            drained, teardown_failures = _teardown_home_rules_and_outbounds(
                binary, commands, address, path.parent, previous_gens,
            )
            if state is not None:
                if not teardown_failures:
                    state["activeHomeGenerations"] = []
                if drained:
                    state["pendingDrainAcks"] = _merge_drain_acks(
                        state.get("pendingDrainAcks"), drained,
                    )
            if teardown_failures:
                home_teardown_note = f"; home outage teardown incomplete: {'; '.join(teardown_failures)}"
    if state is None:
        raise Refusal(
            f"control plane unreachable ({failure}); the state file is unusable: {state_error}"
        ) from failure
    keep_usage_locally(
        path, state, installed, counters, settled_marker, ledger_missing=ledger_missing,
    )
    if roster is None:
        raise Refusal(
            f"control plane unreachable ({failure}) and {unusable}; restored no clients."
            " Usage is kept locally" + home_teardown_note
        ) from failure
    raise Unreachable(
        f"control plane unreachable ({failure}); applied the roster verified {age}s ago"
        f" (+{added} -{removed}). Usage is kept locally" + home_teardown_note
    ) from failure


def restart_for_stuck_revocation(
    path: Path, state: dict, observed_at: int, binary: Path, commands: dict[str, str],
    address: str, tag: str, roster: list[dict[str, str]], *, retire_shared_legacy: bool,
    sleep=time.sleep, clock=time.monotonic,
) -> str | None:
    """Opt-in: restart tono-xray once when a revocation keeps failing.

    Xray drops every API-added client on a restart, so a client its API will not
    remove is gone afterwards and the roster puts the others back. The cost is
    every connection on the node, which is why this is off unless
    TONO_RESTART_XRAY_ON_STUCK_REVOCATION=1, waits for STUCK_REVOCATION_ROUNDS
    reporting rounds, and runs at most once per XRAY_RESTART_INTERVAL_SECONDS of
    roster time (the attempt is saved before systemctl runs, so a failed or
    hanging restart cannot loop). Returns a note for the round's refusal, or
    None when nothing was attempted. The round is never acknowledged here; the
    next timer round converges and acknowledges.
    """
    if os.environ.get("TONO_RESTART_XRAY_ON_STUCK_REVOCATION", "") != "1":
        return None
    stuck = sorted(label for label, rounds in state.get("stuckRemovals", {}).items()
                   if isinstance(rounds, int) and rounds >= STUCK_REVOCATION_ROUNDS)
    if not stuck:
        return None
    attempts = state.get("xrayRestartsUnconverged", 0)
    if isinstance(attempts, int) and attempts >= MAX_RESTARTS_UNCONVERGED:
        # A cause a restart does not fix (a wrong inbound tag, a broken API)
        # must not drop every connection on the node once an hour forever.
        return (f"tono-xray restart stopped: {attempts} attempt(s) did not converge the roster;"
                " an operator must fix the removal")
    last = state.get("xrayRestartAt")
    if isinstance(last, int) and observed_at - last < XRAY_RESTART_INTERVAL_SECONDS:
        return f"tono-xray restart skipped: the last one was at {last} (at most one per hour)"
    # Counters reset on restart. Fold a reading taken right before it, from a
    # known process generation, or the bytes since this round's read are lost.
    try:
        _, _, _, counters, marker = reconcile_and_read_stable(
            binary, commands, address, tag, None, None,
        )
        if not marker:
            return "tono-xray restart skipped: its start marker is unreadable, so usage could not be kept"
        keep_usage_locally(path, state, None, counters, marker)
    except (Refusal, OSError) as error:
        return f"tono-xray restart skipped: usage could not be kept first: {error}"
    state["xrayRestartAt"] = observed_at
    state["xrayRestartsUnconverged"] = (attempts if isinstance(attempts, int) else 0) + 1
    save_state(path, state)
    print(f"restarting tono-xray: revocation of {len(stuck)} client(s) failed"
          f" {STUCK_REVOCATION_ROUNDS}+ rounds in a row", file=sys.stderr)
    try:
        result = subprocess.run(
            [SYSTEMCTL, "--no-ask-password", "restart", XRAY_UNIT],
            capture_output=True, text=True, timeout=60, check=False, env=CHILD_ENV,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return f"tono-xray restart failed: {type(error).__name__}"
    if result.returncode != 0:
        return f"tono-xray restart failed: systemctl exited {result.returncode}"
    # The API needs a moment after the unit starts; until the roster is back
    # every customer on the node is offline, so retry briefly rather than
    # leaving that to the next timer round.
    reason = "the start marker did not change"
    deadline = clock() + RESTART_SETTLE_DEADLINE_SECONDS
    attempt = 0
    while attempt == 0 or clock() + RESTART_SETTLE_SECONDS <= deadline:
        if attempt:
            sleep(RESTART_SETTLE_SECONDS)
        attempt += 1
        if xray_start_marker(binary) in (None, marker):
            continue
        try:
            _, _, installed, _, _ = reconcile_and_read_stable(
                binary, commands, address, tag, roster,
                set(state.get("installedClients", [])),
                retire_shared_legacy=retire_shared_legacy,
            )
        except Refusal as error:
            persist_installed_inventory(path, state, refusal_installed(error))
            reason = f"restoring the roster failed: {error}"
            continue
        # The post-restart reading is not folded: the saved marker still names
        # the old process, so the next round folds the whole new counter.
        persist_installed_inventory(path, state, installed)
        remaining = sorted(set(stuck) & (installed or set()))
        if remaining:
            return f"restarted tono-xray, but {len(remaining)} revoked client(s) are still installed"
        return (f"restarted tono-xray: {len(stuck)} revoked client(s) gone, roster restored;"
                " the next round acknowledges")
    return f"restarted tono-xray, but {reason}"


def run_once(path: Path) -> None:
    base = api_base()
    token = env("TONO_HOME_AGENT_TOKEN")
    binary = xray_binary()
    address = api_address()
    tag = inbound_tag()
    commands = require_commands(binary)
    configured = configured_source()

    override = retire_override(os.environ.get("TONO_RETIRE_SHARED_LEGACY", ""))
    cache = roster_cache_path(path)
    try:
        fetched = fetch_roster_or_discard_cache(base, token, cache)
        node_id, observed_at, roster, server_retire_shared_legacy, watermarks = fetched
        home_identities = getattr(fetched, "home_identities", None)
        home_outbounds = getattr(fetched, "home_outbounds", None)
    except NodeDisabled as disabled:
        # The control plane has spoken: the saved roster must not outlive the
        # node, or a later outage round would reinstall it on a disabled node.
        # fetch_roster_or_discard_cache has normally removed it already; a
        # failure here is reported with the withdrawal, never instead of it.
        try:
            discard_roster_cache(cache)
            cache_note = ""
        except Refusal as refusal:
            cache_note = f"; {refusal}"
        # Withdrawal is revocation: a damaged state file only costs it the
        # durable inventory, never the removal itself.
        try:
            state = load_state(path)
        except (Refusal, ValueError, OSError):
            state = None
        ledger_missing = take_ledger_missing(state) if state is not None else False
        remembered = state.get("installedClients") if state else None
        withdrawal_error: Refusal | None = None
        try:
            withdraw_kwargs = {"state_dir": path.parent} if node_home_commands_present(commands) else {}
            removed, remaining = withdraw_disabled_node(
                binary, commands, address, tag,
                set(remembered) if isinstance(remembered, list) else None,
                **withdraw_kwargs,
            )
        except Refusal as refusal:
            withdrawal_error, removed, remaining = refusal, 0, None
        if remaining is not None and state is not None:
            state["installedClients"] = sorted(remaining)
            save_state(path, state)
        # A final best-effort counter sample, taken after the withdrawal so it
        # can never delay it: the traffic since the last active round is kept
        # in the durable totals for the next round that may report. A metering
        # failure is only noted; it never replaces the withdrawal result.
        metering_note = ""
        if state is None:
            metering_note = "; usage since the last round is not kept: the state file is unusable"
        else:
            try:
                _, _, _, counters, settled_marker = reconcile_and_read_stable(
                    binary, commands, address, tag, None, None,
                )
                keep_usage_locally(
                    path, state, None, counters, settled_marker, ledger_missing=ledger_missing,
                )
            except Exception as error:  # noqa: BLE001 - best effort after withdrawal
                metering_note = f"; usage since the last round is not kept: {error}"
        # The withdrawal also pulls shared-legacy from the running Xray, and
        # only a restart reloads it from the static config: re-enabling a node
        # whose Xray kept running leaves it removed.
        procedure = ("; stop tono-xray now and start it again only when the node is re-enabled"
                     " (the restart restores shared-legacy)")
        if withdrawal_error is not None:
            raise Refusal(
                f"{withdrawal_error}{procedure}{control_plane_said(disabled)}"
                f"{cache_note}{metering_note}"
            ) from withdrawal_error
        # Never a success: the node is out of service and an operator should
        # stop tono-xray. Usage and acknowledgements are not sent.
        raise Refusal(
            f"the control plane reports this exit node disabled; removed {removed} client(s)"
            " and emptied hy2"
            + ("" if remaining is not None else "; the client inventory is unknown")
            + procedure
            + control_plane_said(disabled)
            + cache_note
            + metering_note
        )
    except Exception as error:
        if not control_plane_unreachable(error):
            raise
        run_outage_round(path, configured, binary, commands, address, tag,
                         override, error)
        raise
    # The one check revocation depends on: this roster is for this node.
    if node_id != configured:
        discard_roster_cache(cache)
        raise Refusal(
            f"authenticated exit node {node_id!r} does not match source {configured!r}"
        )
    node_home_capable = False
    detected_xray_ver: str | None = None
    home_capability_reason: str | None = None
    if node_home_commands_present(commands):
        node_home_capable, detected_xray_ver, home_capability_reason = detect_node_home_capability(
            binary, xray_config_path(), commands, tag,
        )
    home_capability_error: Refusal | None = None
    if (home_identities or home_outbounds) and not node_home_capable:
        home_capability_error = Refusal(
            f"control plane delivered home identities, but node is not node-home capable: "
            f"{home_capability_reason or 'unverified node-home configuration'}"
        )
    # Saved before anything is enforced, so the copy never trails a revocation
    # this round has already seen. Never persist homeOutbounds to disk.
    pre_home_marker: str | None = None
    if node_home_capable and home_identities:
        pre_home_marker = xray_start_marker(binary)
        cache_error = save_roster_cache(
            cache, node_id, observed_at, roster, server_retire_shared_legacy, watermarks,
            home_identities=home_identities,
            start_marker=pre_home_marker,
        )
    else:
        cache_error = save_roster_cache(
            cache, node_id, observed_at, roster, server_retire_shared_legacy, watermarks,
        )
    # Revocation runs before every metering check below. A damaged state file,
    # a source mismatch or a queued report ahead of the clock must not keep a
    # revoked, expired or over-quota account connected; the round still refuses
    # afterwards and is never acknowledged.
    try:
        state = load_state(path)
        state_error: Exception | None = None
    except (Refusal, ValueError, OSError) as error:
        state, state_error = None, error
    ledger_missing = take_ledger_missing(state) if state is not None else False
    remembered = state.get("installedClients") if state else None
    previous_home_gens = state.get("activeHomeGenerations") if state else None
    # An explicit environment value wins in both directions so an operator can
    # stop an automatic retirement. An unset value follows the control plane.
    retire_shared_legacy = server_retire_shared_legacy if override is None else override
    # Revocations must reach hy2 even if the following Xray reconciliation
    # fails, and a hy2 failure must not skip the Xray revocation or the counter
    # read. Never ACK the roster unless both installed transports were updated.
    hy2_error: Refusal | None = None
    try:
        sync_hy2_roster(roster)
    except Refusal as error:
        hy2_error = error
    except OSError as error:
        # A filesystem failure (lstat, unlink of the temporary allowlist) is a hy2 failure
        # too; it must not skip the Xray revocation and counter read below.
        hy2_error = Refusal(f"hy2 roster not published: {error}")
    active_home_gens: list[dict[str, str]] = list(previous_home_gens or [])
    drained_now: list[dict[str, str]] = []
    try:
        if node_home_capable:
            res = reconcile_and_read_stable(
                binary, commands, address, tag, roster,
                set(remembered) if isinstance(remembered, list) else None,
                retire_shared_legacy=retire_shared_legacy,
                home_identities=home_identities or [],
                home_outbounds=home_outbounds if home_outbounds is not None else [],
                node_home_capable=True,
                state_dir=path.parent,
                previous_home_generations=previous_home_gens,
            )
            active_home_gens = list(getattr(res, "active_home_generations", []))
            drained_now = list(getattr(res, "drained_generations", []))
        else:
            res = reconcile_and_read_stable(
                binary, commands, address, tag, roster,
                set(remembered) if isinstance(remembered, list) else None,
                retire_shared_legacy=retire_shared_legacy,
            )
        added, removed, installed, counters, settled_marker = res
    except Refusal as error:
        home_state_changed = False
        if hasattr(error, "active_home_generations"):
            active_home_gens = list(getattr(error, "active_home_generations", []))
            if state is not None and state.get("activeHomeGenerations") != active_home_gens:
                state["activeHomeGenerations"] = active_home_gens
                home_state_changed = True
        if hasattr(error, "drained_generations"):
            drained_now = list(getattr(error, "drained_generations", []))
            if state is not None and drained_now:
                merged_drains = _merge_drain_acks(state.get("pendingDrainAcks"), drained_now)
                if state.get("pendingDrainAcks") != merged_drains:
                    state["pendingDrainAcks"] = merged_drains
                    home_state_changed = True
        refusal_inv = refusal_installed(error)
        if home_state_changed and state is not None:
            to_save = dict(state)
            if isinstance(refusal_inv, set):
                to_save["installedClients"] = sorted(
                    label for label in refusal_inv
                    if isinstance(label, str)
                    and (label == LEGACY_CLIENT_EMAIL or is_managed_label(label))
                )
            save_state(path, to_save)
        else:
            persist_installed_inventory(path, state, refusal_inv)
        if hy2_error is not None:
            raise Refusal(f"{hy2_error}; {error}") from error
        if not isinstance(error, PartialReconcile) or state is None:
            raise
        # The other clients were applied. Read the counters on their own and
        # meter the node as usual below, without either acknowledgement: the
        # roster is not converged, but usage (and so quota enforcement) must
        # not wait for the one client the API refused.
        try:
            _, _, _, counters, settled_marker = reconcile_and_read_stable(
                binary, commands, address, tag, None, None,
            )
        except Refusal as read_error:
            raise Refusal(f"{error}; usage not read: {read_error}") from error
        reconcile_error: PartialReconcile | None = error
        added, removed, installed = 0, 0, refusal_installed(error)
    else:
        reconcile_error = None
        if node_home_capable and home_identities and settled_marker != pre_home_marker and not cache_error:
            # Xray restarted during reconcile; bind the outage lease to the new generation.
            cache_error = save_roster_cache(
                cache, node_id, observed_at, roster, server_retire_shared_legacy, watermarks,
                home_identities=home_identities,
                start_marker=settled_marker,
            )
    persist_error: Refusal | None = None
    if retire_shared_legacy:
        # Checked every round: a hand edit or reprovision can put it back.
        # The running Xray is already reconciled; a static-config write failure
        # must not stop the roster ACK or usage reporting (quota enforcement
        # depends on it), so it fails the round only after metering.
        try:
            persist_shared_legacy_retirement(binary, xray_config_path())
        except Refusal as error:
            print(f"shared-legacy retirement not persisted: {error}", file=sys.stderr)
            persist_error = error
    if hy2_error is not None:
        # Xray is reconciled, but hy2 may still admit a revoked account: keep
        # the usage locally and refuse, so the control plane never sees this
        # node as converged and nothing is reported or acknowledged.
        if state is None:
            raise Refusal(f"{hy2_error}; the state file is unusable: {state_error}")
        inventory_base = dict(state)
        try:
            # Same guard as the outage and disabled-node paths. A rebuilt
            # state file must not treat the raw counter as a new lifetime.
            keep_usage_locally(
                path, state, installed, counters, settled_marker,
                ledger_missing=ledger_missing,
            )
        except (Refusal, OSError) as error:
            # source_id can refuse before keep_usage_locally writes. The clients
            # already reconciled still have to be remembered.
            persist_installed_inventory(path, inventory_base, installed)
            raise Refusal(f"{hy2_error}; usage not kept: {error}") from error
        raise hy2_error
    if cache_error and state is not None:
        # An older saved roster is still on disk and may name an account this
        # roster revoked. Never report the round as complete while it is.
        refuse_keeping_usage(Refusal(cache_error), path, state, installed, counters,
                             settled_marker, ledger_missing=ledger_missing)
    if cache_error:
        raise Refusal(cache_error)
    if state is None:
        raise Refusal(f"clients were reconciled, but the state file is unusable: {state_error}")
    durable_state = dict(state)
    try:
        source = source_id(state)
    except Refusal:
        persist_installed_inventory(path, durable_state, installed)
        raise
    for report in state["pendingReports"]:
        pending_at = report.get("observedAt")
        if (
            not isinstance(pending_at, int)
            or isinstance(pending_at, bool)
            or not 0 <= pending_at <= MAX_SAFE_INTEGER
        ):
            refuse_keeping_usage(Refusal("a queued usage report has an invalid observedAt"),
                                 path, state, installed, counters, settled_marker,
                                 ledger_missing=ledger_missing)
        if pending_at > observed_at + 300:
            # A 400 is normally isolated and dropped so one bad account cannot
            # wedge the queue. This report is locally known to be outside the
            # server window, though, so retain it until the server clock catches
            # up instead of silently losing the last growth for an idle account.
            refuse_keeping_usage(
                Refusal("queued usage is more than five minutes ahead of the roster clock"),
                path, state, installed, counters, settled_marker, ledger_missing=ledger_missing,
            )
    if installed is None and reconcile_error is None:
        # Additions can be attempted safely without a live listing, but they do
        # not prove that an old credential generation or shared-legacy client
        # is absent. Never turn that partial result into rollout readiness.
        refuse_keeping_usage(
            Refusal("the live client inventory is unavailable and no durable inventory"
                    " can prove complete reconciliation"),
            path, state, None, counters, settled_marker, ledger_missing=ledger_missing,
        )
    if installed is not None:
        # Keep the reconciled inventory even if the ACK fails, or a newly installed
        # client revoked before the next poll would never be a removal candidate.
        state["installedClients"] = sorted(installed)
        durable_state["installedClients"] = state["installedClients"]
    if node_home_capable:
        state["activeHomeGenerations"] = active_home_gens
        durable_state["activeHomeGenerations"] = active_home_gens
        if drained_now:
            merged_drains = _merge_drain_acks(state.get("pendingDrainAcks"), drained_now)
            state["pendingDrainAcks"] = merged_drains
            durable_state["pendingDrainAcks"] = merged_drains
    if installed is not None or node_home_capable:
        save_state(path, durable_state)
    # Only a complete reconciliation is readiness evidence. A failed ACK keeps
    # the reported totals and the queue as they were, so the roster and any
    # queued usage are retried next round; the counter reading is folded into
    # the lifetime totals so an Xray restart before then cannot forgive it.
    ack_ok = reconcile_error is None and home_capability_error is None
    if ack_ok:
        pending_drains = state.get("pendingDrainAcks") or []
        sent_batch = pending_drains[:MAX_DRAINED_GENERATIONS_PER_ACK]
        try:
            if node_home_capable:
                acknowledge_roster(
                    base,
                    token,
                    observed_at,
                    metering_protocol_version=NODE_HOME_METERING_PROTOCOL_VERSION,
                    node_home_capable=True,
                    node_home_xray_version=detected_xray_ver,
                    home_observed_at=(observed_at if home_outbounds is not None else None),
                    drained_generations=(sent_batch or None),
                )
            elif sent_batch:
                acknowledge_roster(
                    base,
                    token,
                    observed_at,
                    node_home_capable=False,
                    drained_generations=sent_batch,
                )
            else:
                acknowledge_roster(base, token, observed_at)
        except Refusal as ack_error:
            refuse_keeping_usage(ack_error, path, state, installed, counters, settled_marker,
                                 ledger_missing=ledger_missing)
        if sent_batch:
            remaining_drains = pending_drains[len(sent_batch):]
            if remaining_drains:
                state["pendingDrainAcks"] = remaining_drains
            else:
                state.pop("pendingDrainAcks", None)
            save_state(path, state)

    # A batch the server accepted but that was never acknowledged here goes out
    # before newly measured usage: the figure is cumulative per source, so
    # re-sending it counts nothing twice, and losing the acknowledgement must not
    # lose usage.
    if state["pendingReports"]:
        state["pendingReports"] = merge_reports(state["pendingReports"], [])
        save_state(path, state)
        try:
            replayed, discarded = deliver_queue(base, token, path, state)
        except (Unreachable, Refusal) as replay_error:
            # The queue keeps whatever was not delivered. This round's counter
            # reading has not been folded yet; without the fold an Xray restart
            # before delivery comes back forgives it.
            refuse_keeping_usage(replay_error, path, state, installed, counters, settled_marker,
                                 ledger_missing=ledger_missing)
        print(f"replayed {replayed} queued report(s), dropped {discarded}")

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

    timestamp = max(observed_at, int(state.get("lastReportObservedAt", -1)) + 1)
    if timestamp > observed_at + 300:
        # The server rejects observations more than five minutes beyond its own
        # clock. Fold the reading but report nothing, so the bytes go out after
        # server time catches up rather than in a report that a 400 response
        # would discard before any later traffic arrives.
        refuse_keeping_usage(
            Refusal("usage report clock is more than five minutes ahead of the roster clock"),
            path, state, installed, counters, settled_marker, ledger_missing=ledger_missing,
        )
    totals = adopt_source_watermarks(
        lifetime_totals(state, counters, restarted=restarted),
        watermarks if watermarks is not None else source_watermarks(roster),
        ledger_missing=ledger_missing,
    )
    current_user_totals = aggregate_user_totals(totals)
    previous_user_totals = state.get("userTotals")
    if not isinstance(previous_user_totals, dict):
        previous_user_totals = aggregate_user_totals(state.get("totals", {}))

    reports: list[dict] = []
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
    # Consecutive reporting rounds each of our clients has failed revocation
    # in. A label that was removed, or a round that converged, starts over.
    stuck = getattr(reconcile_error, "failed_removals", set())
    previous_stuck = state.get("stuckRemovals")
    if not isinstance(previous_stuck, dict):
        previous_stuck = {}
    state["stuckRemovals"] = {
        label: (rounds if isinstance(rounds := previous_stuck.get(label), int) else 0) + 1
        for label in sorted(stuck) if is_managed_label(label)
    }
    if not state["stuckRemovals"]:
        state.pop("stuckRemovals")
    if reconcile_error is None:
        # Converged: a later stuck revocation gets its full restart budget.
        state.pop("xrayRestartsUnconverged", None)

    # Persist before delivering: a crash after the server accepts must replay, and
    # replaying is safe. The reverse — delivering first — loses usage silently.
    save_state(path, state)
    # The metering ACK is readiness evidence for the whole node, so a round
    # whose reconciliation was incomplete reports usage but never sends it.
    if not state["pendingReports"]:
        if ack_ok:
            acknowledge_metering(base, token, observed_at)
        print("no new usage to report")
    else:
        delivered, dropped = deliver_queue(base, token, path, state)
        if ack_ok:
            acknowledge_metering(base, token, observed_at)
        print(f"reported usage for {delivered} accounts as {source}, dropped {dropped}")
    if reconcile_error is not None:
        # Usage up to this round's reading is saved and delivered by now.
        note = restart_for_stuck_revocation(
            path, state, observed_at, binary, commands, address, tag, roster,
            retire_shared_legacy=retire_shared_legacy,
        )
        if note:
            raise Refusal(f"{reconcile_error}; {note}") from reconcile_error
        raise reconcile_error
    if home_capability_error is not None:
        raise home_capability_error
    if persist_error is not None:
        raise persist_error


def _strip_home_from_roster_cache(cache_path: Path) -> None:
    try:
        raw = cache_path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return
    except OSError as error:
        raise Refusal(f"cannot read roster cache during home withdrawal: {error}") from error
    try:
        doc = json.loads(raw)
    except ValueError:
        discard_roster_cache(cache_path)
        return
    if not isinstance(doc, dict):
        discard_roster_cache(cache_path)
        return
    if "homeIdentities" not in doc and "homeLease" not in doc and "homeOutbounds" not in doc:
        return
    doc.pop("homeIdentities", None)
    doc.pop("homeLease", None)
    doc.pop("homeOutbounds", None)
    temporary: str | None = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".roster-", dir=cache_path.parent)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            os.fchmod(output.fileno(), STATE_MODE)
            json.dump(doc, output, sort_keys=True)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, cache_path)
        temporary = None
    except OSError as error:
        raise Refusal(f"cannot strip residential identities from roster cache: {error}") from error
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass


def run_withdraw_home_once(path: Path) -> None:
    """Safely withdraw all `h:` identities, routes, and `home:*` outbounds while keeping `u:` live."""
    binary = xray_binary()
    address = api_address()
    tag = inbound_tag()
    commands = require_commands(binary)

    try:
        state = load_state(path)
    except (Refusal, ValueError, OSError):
        state = {"totals": {}, "counterBaseline": {}, "pendingReports": []}
    take_ledger_missing(state)
    remembered = set(state.get("installedClients", [])) if isinstance(state.get("installedClients"), list) else set()
    listed = installed_clients(binary, commands, address, tag)
    known = set(listed if listed is not None else remembered)
    h_labels = sorted(lbl for lbl in known if lbl.startswith(HOME_LABEL_PREFIX))

    # Step 1: rmu all h: labels without disturbing u: or shared-legacy.
    _, failures, failed_h = _remove_home_labels_subset(
        binary, commands, address, tag, h_labels, known if listed is not None or remembered else None,
    )

    # Step 2: push fail-closed 3-rule static routing table if add_rules/RoutingService is present.
    previous_gens = state.get("activeHomeGenerations") if isinstance(state.get("activeHomeGenerations"), list) else []
    drained: list[dict[str, str]] = []
    if node_home_commands_present(commands):
        live_outbounds: dict[str, dict[str, Any]] = {}
        lso_ok = False
        try:
            live_outbounds = list_home_outbounds(binary, commands, address)
            lso_ok = True
        except Refusal as error:
            if previous_gens or config_has_node_home_topology(xray_config_path(), tag)[0]:
                failures.append(str(error))
        if lso_ok or previous_gens or config_has_node_home_topology(xray_config_path(), tag)[0]:
            try:
                replace_routing_rules(binary, commands, address, path.parent, build_node_home_rules({}))
            except Refusal as error:
                failures.append(str(error))
            if lso_ok and not failed_h:
                drained, drain_failures = _drain_unused_home_outbounds(
                    binary, commands, address, live_outbounds, set(), previous_gens,
                )
                failures.extend(drain_failures)

    # Update state & strip cached homeIdentities before raising or ACKing.
    kept_installed = sorted(
        lbl for lbl in ((known - set(h_labels)) | failed_h)
        if isinstance(lbl, str) and (lbl == LEGACY_CLIENT_EMAIL or is_managed_label(lbl))
    )
    state["installedClients"] = kept_installed
    if not failed_h and not failures:
        state["activeHomeGenerations"] = []
    if drained:
        state["pendingDrainAcks"] = _merge_drain_acks(state.get("pendingDrainAcks"), drained)
    save_state(path, state)
    _strip_home_from_roster_cache(roster_cache_path(path))

    if failures:
        raise Refusal("home withdrawal incomplete: " + "; ".join(failures))

    has_base = bool(os.environ.get("TONO_API_BASE", "").strip())
    has_token = bool(os.environ.get("TONO_HOME_AGENT_TOKEN", "").strip())
    if has_base and has_token:
        pending_drains = state.get("pendingDrainAcks") or []
        sent_batch = pending_drains[:MAX_DRAINED_GENERATIONS_PER_ACK]
        acknowledge_roster(
            api_base(),
            env("TONO_HOME_AGENT_TOKEN"),
            int(time.time()),
            metering_protocol_version=NODE_HOME_METERING_PROTOCOL_VERSION,
            node_home_capable=False,
            drained_generations=(sent_batch or None),
        )
        if sent_batch:
            remaining_drains = pending_drains[len(sent_batch):]
            if remaining_drains:
                state["pendingDrainAcks"] = remaining_drains
            else:
                state.pop("pendingDrainAcks", None)
            save_state(path, state)
    print(f"withdrew {len(h_labels)} home client(s) and {len(drained)} outbound generation(s); cloud u: untouched")


def main(*, hy2_roster_only: bool = False, withdraw_home: bool = False) -> None:
    if hy2_roster_only and withdraw_home:
        raise Refusal("--hy2-roster-only and --withdraw-home cannot be combined")
    path = state_path()
    with agent_run_lock(path):
        if hy2_roster_only:
            run_hy2_roster_once()
        elif withdraw_home:
            run_withdraw_home_once(path)
        else:
            run_once(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hy2-roster-only", action="store_true",
                        help="sync installed hy2 auth only; no Xray changes, usage, or node-wide ACK")
    parser.add_argument("--withdraw-home", action="store_true",
                        help="tear down h: clients, rules, and home:* outbounds while keeping u: live")
    args = parser.parse_args()
    try:
        main(hy2_roster_only=args.hy2_roster_only, withdraw_home=args.withdraw_home)
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
