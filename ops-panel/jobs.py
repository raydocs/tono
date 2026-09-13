#!/usr/bin/env python3
"""Hub-side executor for control-plane node jobs.

Only the hard-coded handlers in HANDLERS run. Unknown types are posted as
error and never executed. This module is reached solely via `collect.py --jobs`.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

SUMMARY_MAX = 500
RESULT_JSON_MAX = 16384
HEARTBEAT_INTERVAL = 30.0
DEFAULT_TIMEOUT = 120
BATCH_LIMIT = 50
COLLECTOR_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) tono-ops-collector/1.0"

UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    re.I,
)
EMAIL_RE = re.compile(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", re.I)
IPV4_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
PASSWORD_RE = re.compile(r"\bpassword\b", re.I)
LINE_KEEP = re.compile(r"dial|handshake|timeout|reset|refused|REALITY", re.I)
IPV4_EXACT = re.compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")
SAFE_HOST = re.compile(r"^[A-Za-z0-9.:_-]+$")

DIGEST_PATTERNS = (
    ("handshake_fail", re.compile(r"handshake|REALITY", re.I)),
    ("dial_timeout", re.compile(
        r"i/o timeout|dial tcp|connection timed out|connect(?:ion)? timed out|\btimed out\b",
        re.I,
    )),
    ("auth_reject", re.compile(
        r"\bauth(?:entication|orization)?\b|invalid user|unauthori[sz]ed",
        re.I,
    )),
    ("upstream_reject", re.compile(
        r"connection refused|connection reset|reset by peer|\bupstream\b",
        re.I,
    )),
)
DIGEST_CATEGORIES = (
    "dial_timeout",
    "handshake_fail",
    "auth_reject",
    "upstream_reject",
    "other",
)

JOB_TIMEOUTS = {
    "xray_restart": 60,
    "collect_quality": 600,
    "node_probe": 600,
    "node_config_snapshot": 600,
}

VALID_CARRIERS = ("ct", "cu", "cm")
CARRIER_ALIASES = {
    "ct": ("ct", "telecom", "dianxin", "电信"),
    "cu": ("cu", "unicom", "liantong", "联通"),
    "cm": ("cm", "mobile", "yidong", "移动"),
}

TCP_TUNING_KEYS = (
    "net.ipv4.tcp_rmem",
    "net.ipv4.tcp_wmem",
    "net.core.rmem_max",
    "net.core.wmem_max",
    "net.ipv4.tcp_slow_start_after_idle",
)

EXIT_AGENT_UNIT = "tono-exit-agent.service"
EXIT_AGENT_STATE = "/var/lib/tono-exit-agent/state.json"

NEEDS_NODE = frozenset({
    "xray_dial_errors",
    "xray_error_digest",
    "collect_quality",
    "node_probe",
    "node_config_snapshot",
    "xray_restart",
    "identity_sync",
})

Handler = Callable[[dict, "JobContext"], tuple[str, str, dict]]


class ControlPlaneUnreachable(Exception):
    """The ingest API did not answer. The jobs pass should exit non-zero."""


class JobContext:
    def __init__(
        self,
        *,
        node: dict | None,
        nodes: list[dict],
        cn_agents: list[dict],
        token: str,
        collector: Any,
        ssh: Callable[..., tuple[int, str]],
    ) -> None:
        self.node = node
        self.nodes = nodes
        self.cn_agents = cn_agents
        self.token = token
        self.collector = collector
        self.ssh = ssh


def as_int(value: Any, default: int, lo: int, hi: int) -> int:
    try:
        if isinstance(value, bool):
            raise TypeError
        n = int(value)
    except (TypeError, ValueError):
        n = default
    if n < lo:
        return lo
    if n > hi:
        return hi
    return n


def node_allow_ip(node: dict | None) -> str | None:
    if not node:
        return None
    for cand in (node.get("public_ip"), node.get("host")):
        text = str(cand or "").strip()
        if IPV4_EXACT.match(text):
            return text
    return None


def redact_text(text: str, allow_ip: str | None = None) -> str:
    allow = allow_ip if isinstance(allow_ip, str) and IPV4_EXACT.match(allow_ip) else None

    def ipv4(match: re.Match[str]) -> str:
        value = match.group(0)
        return value if allow and value == allow else "[redacted]"

    return PASSWORD_RE.sub(
        "[redacted]",
        IPV4_RE.sub(
            ipv4,
            EMAIL_RE.sub("[redacted]", UUID_RE.sub("[redacted]", text)),
        ),
    )


def redact_value(value: Any, allow_ip: str | None = None) -> Any:
    if isinstance(value, str):
        return redact_text(value, allow_ip)
    if isinstance(value, list):
        return [redact_value(item, allow_ip) for item in value]
    if isinstance(value, dict):
        return {str(key): redact_value(item, allow_ip) for key, item in value.items()}
    return value


def utf8_size(obj: Any) -> int:
    return len(json.dumps(obj, ensure_ascii=False).encode("utf-8"))


def truncate_summary(text: str) -> str:
    text = text or ""
    return text if len(text) <= SUMMARY_MAX else text[:SUMMARY_MAX]


def truncate_result(result: dict, max_bytes: int = RESULT_JSON_MAX) -> dict:
    if not isinstance(result, dict):
        result = {"value": result}
    if utf8_size(result) <= max_bytes:
        return result
    out = dict(result)
    out["truncated"] = True
    if isinstance(out.get("lines"), list):
        lines = list(out["lines"])
        while lines and utf8_size({**out, "lines": lines}) > max_bytes:
            lines.pop()
        out["lines"] = lines
        if utf8_size(out) <= max_bytes:
            return out
    changed = True
    while utf8_size(out) > max_bytes and changed:
        changed = False
        for key, val in list(out.items()):
            if isinstance(val, list) and val:
                out[key] = val[:-1]
                changed = True
                break
            if isinstance(val, dict) and val:
                nested = dict(val)
                if isinstance(nested.get("lines"), list) and nested["lines"]:
                    nested["lines"] = nested["lines"][:-1]
                    out[key] = nested
                    changed = True
                    break
    if utf8_size(out) > max_bytes:
        return {"truncated": True}
    return out


def finalize_result(
    status: str,
    summary: str,
    result: dict,
    allow_ip: str | None = None,
) -> tuple[str, str, dict]:
    if status not in ("ok", "error", "timeout"):
        status = "error"
    summary = truncate_summary(redact_text(str(summary or ""), allow_ip))
    body = result if isinstance(result, dict) else {}
    body = truncate_result(redact_value(body, allow_ip))
    return status, summary, body


def classify_xray_line(line: str) -> str:
    for name, pattern in DIGEST_PATTERNS:
        if pattern.search(line):
            return name
    return "other"


def digest_from_lines(lines: list[str], allow_ip: str | None = None) -> dict:
    counts = {name: 0 for name in DIGEST_CATEGORIES}
    samples: dict[str, str] = {}
    for line in lines:
        if not LINE_KEEP.search(line):
            continue
        category = classify_xray_line(line)
        counts[category] += 1
        if category not in samples:
            samples[category] = redact_text(line, allow_ip)
    return {"counts": counts, "samples": samples}


def _section(text: str, tag: str) -> str:
    match = re.search(rf"==={tag}===\n(.*?)(?====|\Z)", text, re.S)
    return match.group(1).strip() if match else ""


def ssh_exec(node: dict, remote: str, timeout: int = 60) -> tuple[int, str]:
    host = str(node["host"])
    port = int(node.get("port", 22))
    password = str(node["password"])
    env = os.environ.copy()
    env["SSHPASS"] = password
    cmd = [
        "sshpass",
        "-e",
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=15",
        "-p",
        str(port),
        f"root@{host}",
        "bash",
        "-s",
    ]
    try:
        proc = subprocess.run(
            cmd,
            input=remote,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
        text = proc.stdout or ""
        if proc.stderr:
            text = text + ("\n" if text and not text.endswith("\n") else "") + proc.stderr
        return proc.returncode, text
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except Exception as exc:
        return 1, type(exc).__name__


def ssh_agent(agent: dict, remote: str, timeout: int = 25) -> tuple[int, str]:
    host = str(agent.get("host") or "")
    port = int(agent.get("port") or 22)
    password = str(agent.get("password") or "")
    if not host or not password:
        return 1, "missing_agent_credentials"
    env = os.environ.copy()
    env["SSHPASS"] = password
    cmd = [
        "sshpass",
        "-e",
        "ssh",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "ConnectTimeout=12",
        "-p",
        str(port),
        f"root@{host}",
        remote,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        return proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "timeout"
    except Exception as exc:
        return 1, type(exc).__name__


def agent_carrier(agent: dict) -> str | None:
    explicit = str(agent.get("carrier") or "").strip().lower()
    if explicit in CARRIER_ALIASES:
        return explicit
    blob = " ".join(str(agent.get(key) or "") for key in ("carrier", "isp", "name", "label")).lower()
    for code, aliases in CARRIER_ALIASES.items():
        for alias in aliases:
            if alias.lower() in blob:
                return code
    return None


def execute_bounded(
    fn: Callable[[], tuple[str, str, dict]],
    timeout: float,
    on_heartbeat: Callable[[], None] | None = None,
    interval: float = HEARTBEAT_INTERVAL,
) -> tuple[str, str, dict]:
    box: dict[str, Any] = {"done": False, "value": None, "error": None}

    def worker() -> None:
        try:
            box["value"] = fn()
        except Exception as exc:
            box["error"] = exc
        finally:
            box["done"] = True

    thread = threading.Thread(target=worker, daemon=True)
    thread.start()
    deadline = time.monotonic() + max(0.0, float(timeout))
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return "timeout", "handler wall-clock timeout", {}
        thread.join(timeout=min(max(interval, 0.001), remaining))
        if box["done"]:
            if box["error"] is not None:
                err = box["error"]
                return "error", f"{type(err).__name__}: {err}"[:SUMMARY_MAX], {}
            value = box["value"]
            if not (isinstance(value, tuple) and len(value) == 3):
                return "error", "handler returned an invalid result", {}
            status, summary, result = value
            if not isinstance(result, dict):
                result = {}
            return str(status), str(summary), result
        if on_heartbeat is not None:
            try:
                on_heartbeat()
            except Exception:
                pass


def dispatch(job_type: str, params: dict | None, ctx: JobContext | None) -> tuple[str, str, dict]:
    handler = HANDLERS.get(job_type)
    if handler is None:
        return "error", "unsupported job type on this hub", {}
    return handler(params or {}, ctx)


class IngestClient:
    def __init__(
        self,
        base: str,
        token: str,
        urlopen: Callable[..., Any] | None = None,
        user_agent: str = COLLECTOR_UA,
    ) -> None:
        self.base = (base or "").rstrip("/")
        self.token = token
        self.urlopen = urlopen or urllib.request.urlopen
        self.user_agent = user_agent

    def _request(self, method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        data = None if body is None else json.dumps(body, ensure_ascii=False).encode()
        headers = {
            "Accept": "application/json",
            "Authorization": f"Bearer {self.token}",
            "User-Agent": self.user_agent,
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        raw = ""
        status = 0
        try:
            with self.urlopen(req, timeout=30) as resp:
                raw = resp.read().decode() if resp else ""
                status = int(getattr(resp, "status", 200) or 200)
        except urllib.error.HTTPError as exc:
            status = int(exc.code)
            try:
                raw = exc.read().decode() if exc.fp else ""
            except Exception:
                raw = ""
            try:
                exc.close()
            except Exception:
                pass
        except Exception as exc:
            raise ControlPlaneUnreachable(f"{method} {url} {type(exc).__name__}: {exc}") from exc
        if status == 409:
            return 409, {}
        if not (200 <= status < 300):
            raise ControlPlaneUnreachable(f"{method} {url} HTTP {status}")
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        return status, payload

    def lease(self, max_jobs: int) -> dict:
        query = urllib.parse.urlencode({"max": int(max_jobs), "executor": "hub"})
        url = f"{self.base}/api/v1/ops-ingest/jobs?{query}"
        status, payload = self._request("GET", url)
        if status == 409:
            raise ControlPlaneUnreachable("lease HTTP 409")
        return payload

    def heartbeat(self, job_id: str, lease_id: str) -> str:
        url = f"{self.base}/api/v1/ops-ingest/jobs/{urllib.parse.quote(job_id, safe='')}/heartbeat"
        status, _payload = self._request("POST", url, {"leaseId": lease_id})
        return "conflict" if status == 409 else "ok"

    def post_result(
        self,
        job_id: str,
        lease_id: str,
        status: str,
        summary: str,
        result: dict,
    ) -> str:
        url = f"{self.base}/api/v1/ops-ingest/jobs/{urllib.parse.quote(job_id, safe='')}/result"
        body = {
            "leaseId": lease_id,
            "status": status,
            "summary": summary,
            "resultJson": result if isinstance(result, dict) else {},
        }
        code, _payload = self._request("POST", url, body)
        return "conflict" if code == 409 else "ok"


def _journal_remote(since_minutes: int, max_lines: int) -> str:
    return f'journalctl -u xray --since "-{int(since_minutes)}min" -n {int(max_lines)} --no-pager'


def handle_xray_dial_errors(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    since = as_int(params.get("sinceMinutes"), 60, 0, 240)
    max_lines = as_int(params.get("maxLines"), 400, 1, 400)
    rc, text = ctx.ssh(ctx.node, _journal_remote(since, max_lines), 100)
    if rc == 124:
        return "timeout", "ssh timeout reading xray journal", {}
    lines = text.splitlines()
    scanned = len(lines)
    keep = [line for line in lines if LINE_KEEP.search(line)]
    allow = node_allow_ip(ctx.node)
    redacted = [redact_text(line, allow) for line in keep]
    return "ok", f"xray_dial_errors matched={len(redacted)} scanned={scanned}", {
        "lines": redacted,
        "matched": len(redacted),
        "scanned": scanned,
    }


def handle_xray_error_digest(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    since = as_int(params.get("sinceMinutes"), 60, 0, 240)
    rc, text = ctx.ssh(ctx.node, _journal_remote(since, 400), 100)
    if rc == 124:
        return "timeout", "ssh timeout reading xray journal", {}
    digest = digest_from_lines(text.splitlines(), node_allow_ip(ctx.node))
    total = sum(digest["counts"].values())
    return "ok", f"xray_error_digest matched={total}", digest


def handle_collect_quality(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    col = ctx.collector
    node = ctx.node
    quality = col.run_on_node_via_ssh(node)
    ip = str(quality.get("public_ip") or node["host"])
    time.sleep(0.5)
    overseas = col.check_host_tcp_nodes(ip, col.OVERSEAS_NODES, port=443)
    time.sleep(1.0)
    asia = col.check_host_tcp_nodes(ip, col.ASIA_EDGE_NODES, port=443)
    time.sleep(0.5)
    mainland = col.probe_cn_agents(ip, ctx.cn_agents, port=443)
    block = col.classify_block(mainland, asia, overseas)
    quality["block"] = block
    report = {
        "updated_at": int(time.time()),
        "updated_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cn_agents_configured": len(ctx.cn_agents),
        "nodes": [quality],
    }
    pushed = bool(col.put_snapshot(ctx.token, {"report": report}))
    ok = bool(quality.get("ok")) and pushed
    summary = (
        f"quality={quality.get('quality')} block={block.get('status')} "
        f"label={block.get('label')} snapshot={'ok' if pushed else 'fail'}"
    )
    return ("ok" if ok else "error"), summary, {
        "ok": bool(quality.get("ok")),
        "quality": quality.get("quality"),
        "blockStatus": block.get("status"),
        "blockLabel": block.get("label"),
        "snapshot": pushed,
    }


def handle_node_probe(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    requested = params.get("carriers")
    if requested is None:
        carriers = list(VALID_CARRIERS)
    elif isinstance(requested, list):
        carriers = []
        for item in requested:
            if item in VALID_CARRIERS and item not in carriers:
                carriers.append(item)
    else:
        carriers = []
    if not carriers:
        return "error", "no valid carriers requested", {}
    target = str(ctx.node.get("host") or "")
    if not SAFE_HOST.match(target):
        return "error", "invalid node host", {}
    out: dict[str, dict] = {}
    for carrier in carriers:
        agents = [agent for agent in ctx.cn_agents if agent_carrier(agent) == carrier]
        if not agents:
            out[carrier] = {"reachable": False}
            continue
        reachable = False
        latency_ms: int | None = None
        for agent in agents[:6]:
            remote = (
                f"START=$(date +%s%N); "
                f"timeout 5 bash -c 'echo >/dev/tcp/{target}/443' >/dev/null 2>&1; "
                f"EC=$?; END=$(date +%s%N); "
                f"echo EXIT:$EC MS:$(( (END-START)/1000000 ))"
            )
            _rc, text = ssh_agent(agent, remote, timeout=25)
            match = re.search(r"EXIT:(\d+)", text)
            code = int(match.group(1)) if match else _rc
            ms_match = re.search(r"MS:(\d+)", text)
            if code == 0:
                reachable = True
                if ms_match:
                    ms = int(ms_match.group(1))
                    latency_ms = ms if latency_ms is None else min(latency_ms, ms)
            time.sleep(0.4)
        entry: dict[str, Any] = {"reachable": reachable}
        if reachable and latency_ms is not None:
            entry["latencyMs"] = latency_ms
        out[carrier] = entry
    summary = " ".join(
        f"{name}={'up' if row.get('reachable') else 'down'}" for name, row in out.items()
    )
    return "ok", f"node_probe {summary}", out


def handle_node_config_snapshot(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    keys = " ".join(TCP_TUNING_KEYS)
    remote = f"""set +e
echo "===XRAY_VERSION==="
if [ -x /opt/tono-xray/current/xray ]; then /opt/tono-xray/current/xray version 2>&1
elif command -v xray >/dev/null 2>&1; then xray version 2>&1
else echo missing; fi
echo "===PORTS==="
ss -ltnp 2>/dev/null || ss -ltn 2>/dev/null
echo "===KERNEL==="
uname -s -r -v -m
echo "===CC==="
sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null
echo "===TCP==="
for k in {keys}; do printf '%s=%s\\n' "$k" "$(sysctl -n "$k" 2>/dev/null | tr '\\t' ' ')"; done
echo "===TIME==="
timedatectl show 2>/dev/null || true
echo "===DISK==="
df -P / 2>/dev/null | tail -n 1
echo "===UFW==="
ufw status 2>/dev/null | head -n 8
echo "===REALITY_FP==="
python3 - <<'PY'
import hashlib, json, os, subprocess, sys

def find_config():
    for path in (
        "/opt/tono-xray/current/config.json",
        "/etc/xray/config.json",
        "/usr/local/etc/xray/config.json",
    ):
        if os.path.isfile(path):
            return path
    return None

def walk(obj, acc):
    if isinstance(obj, dict):
        pub = obj.get("publicKey")
        if isinstance(pub, str) and pub and "public" not in acc:
            acc["public"] = pub
        priv = obj.get("privateKey")
        if isinstance(priv, str) and priv and "private" not in acc:
            acc["private"] = priv
        for value in obj.values():
            walk(value, acc)
    elif isinstance(obj, list):
        for value in obj:
            walk(value, acc)

path = find_config()
if not path:
    print("missing_config")
    sys.exit(0)
with open(path, encoding="utf-8") as fh:
    cfg = json.load(fh)
keys = {{}}
walk(cfg, keys)
pub = keys.get("public")
if not pub:
    priv = keys.get("private")
    if not priv:
        print("missing_key")
        sys.exit(0)
    xray = None
    for cand in ("/opt/tono-xray/current/xray", "/usr/local/bin/xray", "/usr/bin/xray"):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            xray = cand
            break
    if not xray:
        print("missing_xray")
        sys.exit(0)
    out = subprocess.check_output([xray, "x25519", "-i", priv], text=True, stderr=subprocess.STDOUT)
    for line in out.splitlines():
        if "PublicKey" in line:
            pub = line.split(":", 1)[-1].strip()
            break
    if not pub:
        print("missing_pub")
        sys.exit(0)
print(hashlib.sha256(pub.encode("utf-8")).hexdigest())
PY
echo "===END==="
"""
    rc, text = ctx.ssh(ctx.node, remote, 90)
    if rc == 124:
        return "timeout", "ssh timeout collecting node config", {}
    fp = _section(text, "REALITY_FP").splitlines()[0].strip() if _section(text, "REALITY_FP") else ""
    fingerprint = fp if re.fullmatch(r"[0-9a-f]{64}", fp) else None
    ports = [line.strip() for line in _section(text, "PORTS").splitlines() if line.strip() and not line.lower().startswith("state")]
    tcp: dict[str, str] = {}
    for line in _section(text, "TCP").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            tcp[key.strip()] = value.strip()
    config = {
        "xrayVersion": _section(text, "XRAY_VERSION")[:500],
        "listeningPorts": ports[:40],
        "kernel": _section(text, "KERNEL")[:300],
        "tcpCongestionControl": _section(text, "CC")[:80],
        "tcpTuning": tcp,
        "timedatectl": _section(text, "TIME")[:500],
        "diskFree": _section(text, "DISK")[:200],
        "ufw": _section(text, "UFW")[:400],
        "realityPublicKeySha256": fingerprint,
    }
    if fingerprint is None:
        config["realityPublicKeyError"] = fp or "unavailable"
    summary = "node_config_snapshot ok" if "===END===" in text else "node_config_snapshot incomplete"
    status = "ok" if "===END===" in text else "error"
    return status, summary, {"config": config}


def handle_xray_restart(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    remote = """set +e
systemctl restart xray
RC=$?
sleep 1
echo "===RC==="
echo "$RC"
echo "===SS==="
ss -ltn 2>/dev/null
echo "===END==="
"""
    rc, text = ctx.ssh(ctx.node, remote, 50)
    if rc == 124:
        return "timeout", "ssh timeout restarting xray", {}
    restart_rc = _section(text, "RC")
    try:
        restart_code = int(restart_rc.splitlines()[0].strip()) if restart_rc else rc
    except ValueError:
        restart_code = rc
    listening = bool(re.search(r":443(\s|$)", _section(text, "SS")))
    if restart_code != 0:
        return "error", f"systemctl restart xray failed rc={restart_code}", {
            "restartRc": restart_code,
            "listening443": listening,
        }
    if not listening:
        return "error", "xray restarted but :443 is not listening", {
            "restartRc": restart_code,
            "listening443": False,
        }
    return "ok", "xray restarted; :443 listening", {
        "restartRc": restart_code,
        "listening443": True,
    }


def handle_identity_sync(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    remote = f"""python3 - {EXIT_AGENT_STATE} {EXIT_AGENT_UNIT} <<'PY'
import json, subprocess, sys
from pathlib import Path
path = Path(sys.argv[1])
unit = sys.argv[2]

def load():
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        clients = data.get("installedClients") or []
        return set(clients) if isinstance(clients, list) else set()
    except Exception:
        return set()

before = load()
proc = subprocess.run(["systemctl", "start", unit], capture_output=True, text=True)
after = load()
print("===JSON===")
print(json.dumps({{
    "rc": proc.returncode,
    "added": len(after - before),
    "removed": len(before - after),
    "installed": len(after),
    "stateExists": path.is_file(),
}}))
print("===END===")
PY
"""
    rc, text = ctx.ssh(ctx.node, remote, 100)
    if rc == 124:
        return "timeout", "ssh timeout running identity_sync", {}
    raw = _section(text, "JSON")
    try:
        payload = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    if not payload:
        return "error", "identity_sync produced no state", {}
    if payload.get("rc") not in (0, None):
        return "error", f"identity_sync unit start failed rc={payload.get('rc')}", {
            "added": int(payload.get("added") or 0),
            "removed": int(payload.get("removed") or 0),
            "installed": int(payload.get("installed") or 0),
        }
    added = int(payload.get("added") or 0)
    removed = int(payload.get("removed") or 0)
    return "ok", f"identity_sync added={added} removed={removed}", {
        "added": added,
        "removed": removed,
        "installed": int(payload.get("installed") or 0),
    }


def handle_agent_reinstall(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    return "error", "agent_reinstall not implemented on hub", {}


def handle_home_line_probe(params: dict, ctx: JobContext) -> tuple[str, str, dict]:
    home_id = params.get("homeExitId")
    if not home_id:
        return "error", "missing homeExitId", {}
    probes = ctx.collector.probe_home_lines(ctx.token, home_exit_id=str(home_id))
    if not probes:
        return "error", f"home exit not found or probe failed: {home_id}", {}
    row = probes[0]
    return "ok", f"home_line_probe {row.get('id')} {row.get('status')}", {"probe": row}


HANDLERS: dict[str, Handler] = {
    "xray_dial_errors": handle_xray_dial_errors,
    "xray_error_digest": handle_xray_error_digest,
    "collect_quality": handle_collect_quality,
    "node_probe": handle_node_probe,
    "node_config_snapshot": handle_node_config_snapshot,
    "xray_restart": handle_xray_restart,
    "identity_sync": handle_identity_sync,
    "agent_reinstall": handle_agent_reinstall,
    "home_line_probe": handle_home_line_probe,
}


def run_jobs(
    max_jobs: int = 5,
    *,
    collector: Any = None,
    client: IngestClient | None = None,
    token: str | None = None,
    nodes: list[dict] | None = None,
    cn_agents: list[dict] | None = None,
    heartbeat_interval: float = HEARTBEAT_INTERVAL,
    ssh_fn: Callable[..., tuple[int, str]] | None = None,
    acquire_lock: bool = True,
) -> int:
    col = collector
    if col is None:
        import collect as col  # type: ignore

    try:
        max_jobs = int(max_jobs)
    except (TypeError, ValueError):
        max_jobs = 5
    if max_jobs < 0:
        max_jobs = 0
    if max_jobs > BATCH_LIMIT:
        max_jobs = BATCH_LIMIT

    tok = token if token is not None else col.collector_token()
    if not tok:
        col.log("jobs: missing TONO_OPS_COLLECTOR_TOKEN or /opt/tono-ops/collector.token")
        return 1

    lock_fd = None
    if acquire_lock:
        try:
            col.BASE.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass
        lock_fd = col.acquire_lock(col.BASE / "collect-jobs.lock")
        if lock_fd is None:
            col.log("jobs: previous run still holds the lock; exiting")
            return 0

    unreachable = False
    try:
        loaded_nodes: list[dict] | None = None
        loaded_agents: list[dict] | None = None
        if nodes is None or cn_agents is None:
            try:
                loaded_nodes, loaded_agents = col.load_config()
            except Exception as exc:
                col.log(f"jobs: secrets unavailable {exc}")
                loaded_nodes, loaded_agents = [], []
        if nodes is None:
            nodes = loaded_nodes or []
        if cn_agents is None:
            cn_agents = loaded_agents or []

        ingest = client or IngestClient(getattr(col, "API_BASE", ""), tok)
        try:
            payload = ingest.lease(max_jobs)
        except ControlPlaneUnreachable as exc:
            col.log(f"jobs: control plane unreachable {exc}")
            return 1

        lease_id = str(payload.get("leaseId") or "")
        leased = payload.get("jobs") or []
        if not isinstance(leased, list):
            leased = []
        if not leased:
            col.log("jobs: nothing leased")
            return 0
        if not lease_id:
            col.log("jobs: lease response missing leaseId")
            return 1

        by_name = {str(node.get("name")): node for node in nodes or []}
        runner = ssh_fn or ssh_exec

        for job in leased:
            if not isinstance(job, dict):
                continue
            job_id = str(job.get("id") or "")
            if not job_id:
                continue
            node_name = str(job.get("nodeName") or "")
            node = by_name.get(node_name)
            job_type = str(job.get("type") or "")
            params = job.get("params") if isinstance(job.get("params"), dict) else {}
            allow_ip = node_allow_ip(node)

            def heartbeat(job_id: str = job_id) -> None:
                try:
                    ingest.heartbeat(job_id, lease_id)
                except ControlPlaneUnreachable as exc:
                    col.log(f"jobs: heartbeat failed {job_id} {exc}")

            def run_handler(
                job_type: str = job_type,
                params: dict = params,
                node: dict | None = node,
                node_name: str = node_name,
            ) -> tuple[str, str, dict]:
                ctx = JobContext(
                    node=node,
                    nodes=list(nodes or []),
                    cn_agents=list(cn_agents or []),
                    token=tok,
                    collector=col,
                    ssh=runner,
                )
                if job_type not in HANDLERS:
                    return "error", "unsupported job type on this hub", {}
                if job_type in NEEDS_NODE and node is None:
                    return "error", f"unknown node {node_name}", {}
                return HANDLERS[job_type](params, ctx)

            if job_type not in HANDLERS:
                status, summary, result = finalize_result(
                    "error",
                    "unsupported job type on this hub",
                    {},
                    allow_ip,
                )
            else:
                timeout = JOB_TIMEOUTS.get(job_type, DEFAULT_TIMEOUT)
                status, summary, result = execute_bounded(
                    run_handler,
                    timeout=timeout,
                    on_heartbeat=heartbeat,
                    interval=heartbeat_interval,
                )
                status, summary, result = finalize_result(status, summary, result, allow_ip)

            try:
                posted = ingest.post_result(job_id, lease_id, status, summary, result)
                if posted == "conflict":
                    col.log(f"jobs: lease conflict on result {job_id}")
                else:
                    col.log(f"jobs: {job_id} {job_type} {node_name} {status}")
            except ControlPlaneUnreachable as exc:
                col.log(f"jobs: result post failed {job_id} {exc}")
                unreachable = True
        return 1 if unreachable else 0
    finally:
        if lock_fd is not None:
            try:
                os.close(lock_fd)
            except Exception:
                pass
