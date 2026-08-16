#!/usr/bin/env python3
"""Answer one question about one exit: is it actually in the fleet, everywhere?

A node is reachable long before it is onboarded, and every remaining step fails
silently. A node missing from the identity sync accepts nobody; one missing from
Komari is invisible while it serves customers; one missing from the ops hub
registry works today and rots. None of that raises an error anywhere.

So this reads the state back from each system rather than trusting that a step
was run. Read-only: it changes nothing.

    python3 tooling/scripts/check-node-in-fleet.py "Los Angeles · Mesa" 179.255.154.17
"""

from __future__ import annotations

import json
import subprocess
import sys

HUB = "199.30.91.172"
HUB_SSH = "tono-199.30.91.172"
CONTROL_PLANE = "https://api.afk.ccwu.cc"
ADMIN_KEYCHAIN = "tono-admin"


def keychain(service: str) -> str:
    r = subprocess.run(["/usr/bin/security", "find-generic-password", "-s", service, "-w"],
                       capture_output=True, text=True)
    return r.stdout.strip()


def hub(script: str, timeout: int = 60) -> str:
    r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", HUB_SSH, script],
                       capture_output=True, text=True, timeout=timeout)
    return r.stdout.strip()


def node(host: str, script: str, timeout: int = 45) -> tuple[bool, str]:
    for target in (f"tono-dmit-{host}", f"tono-{host}"):
        r = subprocess.run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", target, script],
                           capture_output=True, text=True, timeout=timeout)
        if r.returncode == 0:
            return True, r.stdout.strip()
    # Fall back to the hub, which holds credentials for every node.
    out = hub(
        "python3 - <<'PY'\n"
        "import json,subprocess,os\n"
        f"d=json.load(open('/opt/tono-ops/nodes.secrets.json'))\n"
        f"n=[x for x in d['nodes'] if x.get('host')=={host!r}]\n"
        "if not n: print('__NOT_REGISTERED__'); raise SystemExit\n"
        "n=n[0]; env=dict(os.environ); env['SSHPASS']=n.get('password','')\n"
        "base=(['ssh','-i','/opt/tono-ops/tono-collector','-o','IdentitiesOnly=yes','-o','BatchMode=yes',\n"
        "       '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile=/opt/tono-ops/tono-collector-known-hosts']\n"
        "      if n.get('key') else\n"
        "      ['sshpass','-e','ssh','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null'])\n"
        "base += ['-o','LogLevel=ERROR','-o','ConnectTimeout=15','-p',str(n.get('port',22)),\n"
        "         '%s@%s' % (n.get('user','root'), n['host'])]\n"
        f"r=subprocess.run(base+[{script!r}],capture_output=True,text=True,timeout=40,env=env)\n"
        "print(r.stdout.strip() or '__UNREACHABLE__')\n"
        "PY", timeout=90)
    if "__NOT_REGISTERED__" in out or "__UNREACHABLE__" in out or not out:
        return False, out
    return True, out


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip())
        return 2
    name, host = sys.argv[1], sys.argv[2]
    results: list[tuple[str, bool | None, str]] = []

    token = keychain(ADMIN_KEYCHAIN)
    try:
        raw = subprocess.run(
            ["curl", "-s", "--max-time", "25", "-H", f"Authorization: Bearer {token}",
             "-H", "Accept: application/json", f"{CONTROL_PLANE}/api/v1/admin/exit-catalog"],
            capture_output=True, text=True, timeout=40).stdout
        cat = json.loads(raw)
        yaml = cat.get("yaml", "")
        listed = name in yaml
        placeholder = f'"{name}"' in yaml or name in yaml
        results.append(("catalog (customers can select it)", listed,
                        f"revision {cat.get('revision')}" if listed else "not in the published catalog"))
        if listed:
            # Every entry must carry the placeholder or that node serves one shared identity.
            block = yaml[yaml.index(name):]
            uuid_line = next((l for l in block.splitlines() if "uuid:" in l), "")
            ok = "{{TONO_CLIENT_UUID}}" in uuid_line
            results.append(("  └ per-account identity placeholder", ok,
                            uuid_line.strip() if not ok else "{{TONO_CLIENT_UUID}}"))
    except Exception as exc:
        results.append(("catalog (customers can select it)", None, f"could not read: {type(exc).__name__}"))

    reg = hub("python3 -c \"import json;d=json.load(open('/opt/tono-ops/nodes.secrets.json'));"
              f"n=[x for x in d['nodes'] if x.get('host')=='{host}'];"
              "print('yes' if n else 'no', (n[0].get('key') and 'key-auth' or 'password-auth') if n else '')\"")
    results.append(("ops hub registry (receives accounts)", reg.startswith("yes"), reg[4:].strip() or "absent"))

    # Recency, not a total. A node that died months ago still has thousands of
    # historical passes in this log, so counting them answers nothing — the
    # question is whether the sync reached it in the last few minutes.
    synced = hub("python3 - <<'PY'\n"
                 "import re, time, datetime\n"
                 "cut = time.time() - 900\n"
                 "last = None\n"
                 "try:\n"
                 "    for line in open('/var/log/tono-ops-sync.log', errors='replace'):\n"
                 f"        if 'sync ' + {name!r} + ':' not in line: continue\n"
                 # A failure is logged on the same line shape as a success:
                 #   sync <name>: ssh: connect ... timed out
                 # Matching the name alone reported a dead node as freshly
                 # synced. Only a pass that reported a roster carries 'managed='.
                 "        if 'managed=' not in line: continue\n"
                 "        m = re.match(r'(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z)', line)\n"
                 "        if m: last = m.group(1)\n"
                 "except OSError:\n"
                 "    pass\n"
                 "if not last:\n"
                 "    print('never')\n"
                 "else:\n"
                 "    ts = datetime.datetime.strptime(last, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()\n"
                 "    age = int(time.time() - ts)\n"
                 "    print(('fresh ' if ts >= cut else 'stale ') + str(age))\n"
                 "PY")
    fresh = synced.startswith("fresh")
    if synced.startswith("never"):
        detail = "never synced"
    else:
        secs = synced.split()[-1] if " " in synced else "?"
        detail = f"last sync {secs}s ago" + ("" if fresh else "  <-- stale")
    results.append(("  └ synced within the last 15 min", fresh, detail))

    kom = hub("python3 - <<'PY'\n"
              "import json,urllib.request,http.cookiejar\n"
              "K='http://127.0.0.1:25774'; c={}\n"
              "for l in open('/root/komari-admin.txt'):\n"
              "    if '=' in l: k,v=l.split('=',1); c[k.strip()]=v.strip()\n"
              "j=http.cookiejar.CookieJar(); o=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(j))\n"
              "def call(m,p,b=None):\n"
              "    d=json.dumps(b).encode() if b is not None else None\n"
              "    r=urllib.request.Request(K+p,data=d,method=m,headers={'Content-Type':'application/json'})\n"
              "    return json.loads(o.open(r,timeout=15).read().decode() or '{}')\n"
              "call('POST','/api/login',{'username':c.get('username'),'password':c.get('password')})\n"
              "n=call('GET','/api/nodes'); items=n.get('data') if isinstance(n,dict) else n\n"
              f"m=[x for x in items if {name!r} in str(x.get('name',''))]\n"
              "print(('yes ' + m[0]['uuid'][:8]) if m else 'no')\n"
              "PY")
    results.append(("komari monitoring", kom.startswith("yes"), kom[4:].strip() or "not registered"))

    ok, out = node(host,
                   "printf '%s %s %s %s' "
                   "\"$(systemctl is-active tono-xray 2>/dev/null)\" "
                   "\"$(systemctl is-active komari-agent 2>/dev/null)\" "
                   "\"$(sysctl -n net.core.wmem_max 2>/dev/null)\" "
                   "\"$(python3 -c \"import json;c=json.load(open('/opt/tono-xray/current/config.json'));"
                   "print(sum(1 for i in c['inbounds'] if i.get('tag')=='tono-vless' "
                   "for cl in i['settings']['clients'] if str(cl.get('email','')).startswith('u:')))\" 2>/dev/null)\"")
    if ok and out and "__" not in out:
        parts = out.split()
        xray, agent, wmem, ids = (parts + ["?"] * 4)[:4]
        results.append(("xray service", xray == "active", xray))
        results.append(("komari agent running", agent == "active", agent))
        results.append(("tcp tuning applied", wmem == "16777216", f"wmem_max={wmem}"))
        results.append(("account identities installed", ids.isdigit() and int(ids) > 0, f"{ids} u:<userId> clients"))
    else:
        results.append(("node itself", False, "unreachable over SSH from here and from the hub"))

    width = max(len(r[0]) for r in results)
    bad = 0
    print(f"\n{name}  ({host})\n")
    for label, state, detail in results:
        mark = "ok  " if state else ("??  " if state is None else "MISS")
        if state is False:
            bad += 1
        print(f"  {mark} {label.ljust(width)}  {detail}")
    print()
    print("  fully onboarded" if bad == 0 else f"  {bad} step(s) incomplete — see .claude/skills/add-tono-node")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
