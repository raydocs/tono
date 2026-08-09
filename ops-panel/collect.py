#!/usr/bin/env python3
"""Tono ops collector: securityCheck + backtrace + multi-source block probe. 12h serial.

Block sources (in priority order):
1) mainland_probes in nodes.secrets.json — real CT/CU/CM TCP :443 agents (authoritative)
2) check-host Asia edge (HK/JP/SG) — reliable public TCP, labeled edge (not 三网)
3) check-host overseas baseline — distinguishes "down" vs "only China-side issue"

itdog is no longer used (captcha / no wss task payload).
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = Path("/opt/tono-ops")
REPORT = BASE / "report.json"
WWW_REPORT = BASE / "www" / "report.json"
SECRETS = BASE / "nodes.secrets.json"
LOG = Path("/var/log/tono-ops-collect.log")
KOMARI = "http://127.0.0.1:25774"
CREDS = Path("/root/komari-admin.txt")

SC_URL = "https://github.com/oneclickvirt/securityCheck/releases/download/output/securityCheck-linux-amd64"
BT_URL = "https://github.com/oneclickvirt/backtrace/releases/download/output/backtrace-linux-amd64"
SC_CDN = "https://cdn.spiritlhl.net/https://github.com/oneclickvirt/securityCheck/releases/download/output/securityCheck-linux-amd64"
BT_CDN = "https://cdn.spiritlhl.net/https://github.com/oneclickvirt/backtrace/releases/download/output/backtrace-linux-amd64"

# Public check-host nodes (no mainland China nodes available on this network).
ASIA_EDGE_NODES = [
    "hk1.node.check-host.net",
    "jp1.node.check-host.net",
    "sg1.node.check-host.net",
]
OVERSEAS_NODES = [
    "us1.node.check-host.net",
    "us2.node.check-host.net",
    "de1.node.check-host.net",
    "nl1.node.check-host.net",
    "gb1.node.check-host.net",
    "fr2.node.check-host.net",
]


def log(msg: str) -> None:
    line = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg
    print(line, flush=True)
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def sh(cmd: str, timeout: int = 180) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return 124, "timeout"


def check_host_tcp_nodes(ip: str, nodes: list[str], port: int = 443, waits: int = 8) -> dict:
    """TCP connect probe via selected check-host nodes."""
    host = f"{ip}:{port}"
    qs = "&".join(f"node={urllib.parse.quote(n)}" for n in nodes)
    url = f"https://check-host.net/check-tcp?host={urllib.parse.quote(host)}&{qs}"
    req = urllib.request.Request(
        url, headers={"User-Agent": "tono-ops/3.0", "Accept": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            start = json.loads(r.read().decode())
    except Exception as e:
        return {"ok": False, "error": type(e).__name__, "nodes": nodes}
    rid = start.get("request_id")
    node_meta = start.get("nodes") or {}
    if not rid:
        return {"ok": False, "error": "no_request_id", "nodes": nodes}
    last: dict = {}
    for _ in range(waits):
        time.sleep(2.0)
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    f"https://check-host.net/check-result/{rid}",
                    headers={"User-Agent": "tono-ops/3.0", "Accept": "application/json"},
                ),
                timeout=40,
            ) as r:
                last = json.loads(r.read().decode())
        except Exception:
            continue
        ready = sum(1 for v in (last or {}).values() if v is not None)
        if ready >= max(1, len(nodes) // 2):
            break

    detail = {}
    success = fail = 0
    for node_key, payload in (last or {}).items():
        label = node_key
        meta = node_meta.get(node_key)
        if isinstance(meta, list) and len(meta) >= 3:
            label = f"{meta[1]} {meta[2]}"
        ok = False
        ms = None
        if isinstance(payload, list) and payload:
            first = payload[0]
            if isinstance(first, dict) and "error" not in first and ("time" in first or "address" in first):
                ok = True
                try:
                    ms = round(float(first.get("time", 0)) * 1000)
                except Exception:
                    ms = None
            elif isinstance(first, list) and first and isinstance(first[0], dict) and "time" in first[0]:
                ok = True
                try:
                    ms = round(float(first[0].get("time", 0)) * 1000)
                except Exception:
                    ms = None
        detail[node_key] = {"ok": ok, "ms": ms, "label": label}
        if payload is None:
            continue
        if ok:
            success += 1
        else:
            fail += 1
    total = success + fail
    rate = success / total if total else 0.0
    return {
        "ok": True,
        "success": success,
        "fail": fail,
        "rate": rate,
        "total": total,
        "detail": detail,
        "request_id": rid,
        "source": "check-host",
    }


def probe_cn_agents(ip: str, agents: list[dict], port: int = 443) -> dict | None:
    """Authoritative mainland probe: SSH to CT/CU/CM hosts and TCP-connect to target:port."""
    if not agents:
        return None
    detail = {}
    ok_n = fail_n = 0
    for agent in agents[:6]:
        name = str(agent.get("name") or agent.get("host") or "agent")
        host = str(agent.get("host") or "")
        ssh_port = int(agent.get("port") or 22)
        password = str(agent.get("password") or "")
        if not host or not password:
            continue
        # Bash /dev/tcp is enough; no extra packages on agent.
        remote = (
            f"timeout 5 bash -c 'echo >/dev/tcp/{ip}/{port}' >/dev/null 2>&1; echo EXIT:$?"
        )
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
            str(ssh_port),
            f"root@{host}",
            remote,
        ]
        try:
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=25, env=env)
            text = (p.stdout or "") + (p.stderr or "")
            m = re.search(r"EXIT:(\d+)", text)
            code = int(m.group(1)) if m else p.returncode
            success = code == 0
        except Exception as e:
            success = False
            code = -1
            text = type(e).__name__
        detail[name] = {"ok": success, "code": code, "host": host}
        if success:
            ok_n += 1
        else:
            fail_n += 1
        time.sleep(0.4)

    total = ok_n + fail_n
    if total == 0:
        return None
    if fail_n * 3 >= total * 2:  # >= 2/3 fail
        status = "LIKELY_BLOCKED"
    elif ok_n * 3 >= total * 2:  # >= 2/3 ok
        status = "OK"
    elif ok_n >= 1:
        status = "DEGRADED"
    else:
        status = "LIKELY_BLOCKED"
    return {
        "status": status,
        "ok": ok_n,
        "fail": fail_n,
        "total": total,
        "detail": detail,
        "source": "cn_agents_tcp443",
        "note": "大陆 agent TCP :443；≥2/3 失败=疑似被墙",
        "authoritative": True,
    }


def classify_block(cn: dict | None, asia: dict, overseas: dict) -> dict:
    """Produce final block object for UI."""
    ov_ok = bool(overseas.get("ok") and overseas.get("rate", 0) >= 0.5)
    asia_ok = bool(asia.get("ok") and asia.get("rate", 0) >= 0.5)
    asia_all_fail = bool(asia.get("ok") and asia.get("total", 0) > 0 and asia.get("success", 0) == 0)

    if cn and cn.get("authoritative"):
        status = cn["status"]
        return {
            "status": status,
            "label": {
                "OK": "正常",
                "LIKELY_BLOCKED": "疑似被墙",
                "DEGRADED": "部分不通",
            }.get(status, status),
            "mainland": cn,
            "asia_edge": asia,
            "overseas": overseas,
            "rule": "大陆 agent ≥2/3 失败 => 疑似被墙；海外基线仅用于区分整机宕机",
        }

    # No mainland agents: never claim 被墙 from overseas LG alone.
    if not ov_ok and overseas.get("ok"):
        # measured overseas mostly fail
        status, label = "DOWN", "不通"
    elif not ov_ok:
        status, label = "CHECK_FAILED", "基线失败"
    elif asia_all_fail:
        status, label = "EDGE_FAIL", "边缘不通"
    elif asia_ok:
        status, label = "EDGE_OK", "边缘可达"
    else:
        status, label = "UNPROBED", "未测大陆"

    return {
        "status": status,
        "label": label,
        "mainland": {
            "status": "UNPROBED",
            "note": "未配置 mainland_probes；无法做电信/联通/移动权威探测",
            "source": "none",
        },
        "asia_edge": asia,
        "overseas": overseas,
        "rule": "无大陆 agent 时不判定被墙；HK/JP/SG 仅作边缘参考",
    }


def parse_quality(sc: str, bt: str) -> dict:
    """Only surface quality when it matters (poor). Drop 'mixed' noise from DNS blacklists."""
    routes = []
    for kw in (
        "CN2 GIA",
        "CN2GT",
        "CN2",
        "AS9929",
        "9929",
        "AS4837",
        "4837",
        "163",
        "CMIN2",
        "CMI",
        "CTGNET",
    ):
        if kw in bt and kw not in routes:
            routes.append(kw)

    risks = []
    if not sc or "missing" in sc:
        return {"quality": "ok", "risk_keywords": [], "route_keywords": routes[:12]}

    severe = 0
    for pat, tag in (
        (r"是否是恶意[^\n]*Yes", "malicious"),
        (r"是否是垃圾邮件[^\n]*Yes", "spam"),
        (r"是否是攻击[^\n]*Yes", "attacker"),
        (r"是否攻击者[^\n]*Yes", "attacker"),
        (r"是否滥用者[^\n]*Yes", "abuser"),
        (r"是否威胁[^\n]*Yes", "threat"),
        (r"is on SPAMHAUS[^\n]*", "spamhaus"),
    ):
        if re.search(pat, sc, re.I):
            severe += 1
            risks.append(tag)

    abuse = None
    m3 = re.search(r"滥用得[分分数][^\d]*(\d+)|滥用分数[^\d]*(\d+)|Abuse[^\d]*(\d+)", sc, re.I)
    if m3:
        abuse = int(next(g for g in m3.groups() if g))

    # Only mark poor for strong signals. DNS blacklist counts alone are ignored (UI noise).
    if severe >= 2 or (abuse is not None and abuse >= 85) or "spamhaus" in risks:
        q = "poor"
    else:
        q = "ok"

    return {"quality": q, "risk_keywords": risks[:8], "route_keywords": routes[:12]}


def run_on_node_via_ssh(node: dict) -> dict:
    host = node["host"]
    port = int(node.get("port", 22))
    password = node["password"]
    name = node["name"]

    remote = f"""set -e
DIR=/opt/tono-quality
mkdir -p "$DIR"
cd "$DIR"
dl() {{
  f="$1"; u="$2"; c="$3"
  if [ -x "$f" ] && [ -s "$f" ]; then return 0; fi
  curl -fsSL --retry 2 -o "$f.tmp" "$u" || curl -fsSL --retry 2 -o "$f.tmp" "$c" || return 1
  mv "$f.tmp" "$f"; chmod 700 "$f"
}}
dl securityCheck "{SC_URL}" "{SC_CDN}" || true
dl backtrace "{BT_URL}" "{BT_CDN}" || true
PUB=$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || echo unknown)
echo "===META==="
echo "public_ip=$PUB"
date -u +%Y-%m-%dT%H:%M:%SZ
echo "===SECURITY_CHECK==="
if [ -x ./securityCheck ]; then timeout 90 ./securityCheck -c ipv4 -e yes -l zh 2>&1 || true; else echo missing; fi
echo "===BACKTRACE==="
if [ -x ./backtrace ]; then timeout 180 ./backtrace -s 2>&1 || true; else echo missing; fi
echo "===END==="
"""
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
        p = subprocess.run(cmd, input=remote, capture_output=True, text=True, timeout=420, env=env)
        text = (p.stdout or "") + "\n" + (p.stderr or "")
        rc = p.returncode
    except subprocess.TimeoutExpired:
        return {"name": name, "host": host, "ok": False, "error": "ssh_timeout"}
    except Exception as e:
        return {"name": name, "host": host, "ok": False, "error": type(e).__name__}

    def sec(tag: str) -> str:
        m = re.search(rf"==={tag}===\n(.*?)(?====|\Z)", text, re.S)
        return m.group(1).strip() if m else ""

    meta, sc, bt = sec("META"), sec("SECURITY_CHECK"), sec("BACKTRACE")
    pub = ""
    for line in meta.splitlines():
        if line.startswith("public_ip="):
            pub = line.split("=", 1)[1].strip()
    q = parse_quality(sc, bt)
    return {
        "name": name,
        "host": host,
        "ok": "===END===" in text,
        "rc": rc,
        "public_ip": pub or host,
        "security_check": sc[:10000],
        "backtrace": bt[:10000],
        **q,
    }


def komari_tag(nodes: list[dict]) -> None:
    if not CREDS.exists():
        return
    creds = {}
    for line in CREDS.read_text(encoding="utf-8", errors="replace").splitlines():
        if "=" in line:
            k, v = line.split("=", 1)
            creds[k.strip()] = v.strip()
    jar = http.cookiejar.CookieJar()
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

    def call(method: str, path: str, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(
            KOMARI + path,
            data=data,
            method=method,
            headers={
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
        )
        with op.open(req, timeout=30) as r:
            return json.loads(r.read().decode() or "{}")

    try:
        call("POST", "/api/login", {"username": creds.get("username"), "password": creds.get("password")})
        clients = call("GET", "/api/admin/client/list")
        if not isinstance(clients, list):
            return
        by = {c.get("name"): c for c in clients}
        for n in nodes:
            c = by.get(n.get("name"))
            if not c:
                continue
            block = n.get("block") or {}
            status = block.get("status", "")
            label = block.get("label") or status
            routes = "/".join((n.get("route_keywords") or [])[:3]) or "-"
            if status == "LIKELY_BLOCKED":
                tag = "⚠️疑似被墙"
            elif status == "OK":
                tag = f"大陆可达|{routes}"[:60]
            elif status == "EDGE_OK":
                tag = f"边缘可达|{routes}"[:60]
            elif status == "EDGE_FAIL":
                tag = "边缘不通"
            elif status == "DOWN":
                tag = "不通"
            else:
                tag = f"{label}|{routes}"[:60]
            body = {
                "uuid": c["uuid"],
                "name": c.get("name"),
                "tags": tag,
                "group": c.get("group") or "",
                "price": c.get("price") or 0,
                "billing_cycle": c.get("billing_cycle") or 0,
                "currency": c.get("currency") or "$",
                "traffic_limit": c.get("traffic_limit") or 0,
                "traffic_limit_type": c.get("traffic_limit_type") or "sum",
                "auto_renewal": c.get("auto_renewal") or False,
                "hidden": c.get("hidden") or False,
                "region_override": c.get("region_override") or "",
            }
            try:
                call("POST", f"/api/admin/client/{c['uuid']}/edit", body)
            except Exception as e:
                log(f"tag_fail {n.get('name')} {e}")
    except Exception as e:
        log(f"komari_tag_error {e}")


def load_config() -> tuple[list[dict], list[dict]]:
    raw = json.loads(SECRETS.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw, []
    nodes = raw.get("nodes") or raw.get("vps") or []
    agents = raw.get("mainland_probes") or raw.get("cn_probes") or []
    return nodes, agents


def main() -> None:
    BASE.mkdir(parents=True, exist_ok=True)
    (BASE / "www").mkdir(parents=True, exist_ok=True)
    if not SECRETS.exists():
        log("missing nodes.secrets.json")
        return
    sh(
        "command -v sshpass >/dev/null || "
        "(apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sshpass)"
    )
    nodes_cfg, cn_agents = load_config()
    if not nodes_cfg:
        log("no nodes in secrets")
        return
    log(f"cn_agents={len(cn_agents)} nodes={len(nodes_cfg)}")

    out_nodes = []
    for node in nodes_cfg:
        log(f"collect {node['name']}")
        q = run_on_node_via_ssh(node)
        ip = str(q.get("public_ip") or node["host"])
        time.sleep(0.5)
        overseas = check_host_tcp_nodes(ip, OVERSEAS_NODES, port=443)
        time.sleep(1.0)
        asia = check_host_tcp_nodes(ip, ASIA_EDGE_NODES, port=443)
        time.sleep(0.5)
        cn = probe_cn_agents(ip, cn_agents, port=443)
        block = classify_block(cn, asia, overseas)
        q["block"] = block
        # Keep legacy field for older UI: status is still the machine-readable code.
        out_nodes.append(q)
        log(f"  quality={q.get('quality')} block={block.get('status')} label={block.get('label')}")

    report = {
        "updated_at": int(time.time()),
        "updated_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "policy": "12h serial; CN agents authoritative for 被墙; else Asia edge + overseas baseline",
        "latency_note": "Komari: CN DNS 223.5.5.5 / 119.29.29.29 / 114.114.114.114 every 10m",
        "sources": {
            "securityCheck": "oneclickvirt/securityCheck",
            "backtrace": "oneclickvirt/backtrace",
            "block_authoritative": "mainland_probes (SSH TCP :443 from CT/CU/CM hosts)",
            "block_edge": "check-host HK/JP/SG TCP :443",
            "block_overseas": "check-host US/EU TCP :443",
            "ecs_ref": "https://github.com/spiritLHLS/ecs",
        },
        "cn_agents_configured": len(cn_agents),
        "nodes": out_nodes,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    REPORT.write_text(text, encoding="utf-8")
    REPORT.chmod(0o600)
    WWW_REPORT.write_text(text, encoding="utf-8")
    komari_tag(out_nodes)
    log("done")


if __name__ == "__main__":
    main()
