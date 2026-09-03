#!/usr/bin/env python3
"""Answer one question about one exit: is it actually in the fleet, everywhere?

A node is reachable long before it is onboarded, and every remaining step fails
silently. A node missing from the identity sync accepts nobody; one that was
never metered carries customer traffic and bills nobody; one missing from Komari
is invisible while it serves customers; one missing from the ops hub registry
works today and rots. None of that raises an error anywhere.

So this reads the state back from each system rather than trusting that a step
was run. Read-only: it changes nothing.

    python3 tooling/scripts/check-node-in-fleet.py "Los Angeles · Mesa" 179.255.154.17
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request

HUB = "199.30.91.172"
HUB_SSH = "tono-199.30.91.172"
CONTROL_PLANE = "https://api.afk.ccwu.cc"
ADMIN_KEYCHAIN = "tono-admin"
HOST_KEY_UNPINNED = ("host key not verified against /opt/tono-ops/tono-collector-known-hosts on the hub — "
                     "compare the fingerprint with the provider console, pin it there, and re-run")
# The Reality front measurement, shared with the provisioner so a re-measurement
# cannot update one of them and leave the other reporting the old answer.
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "reality-fronts.json"),
          encoding="utf-8") as handle:
    REALITY_FRONTS = json.load(handle)
# Where the meter lives on a node: what enable-tono-exit-metering.sh leaves
# behind, and what services/exit-agent/reconcile_and_report.py expects to find.
METER_API = "127.0.0.1:10085"
METER_STATE = "/var/lib/tono-exit-agent/state.json"
METER_STATE_MAX_AGE = 3600


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects, the way curl does without -L.

    urllib follows 3xx by default and copies Authorization onto the new
    request, cross-host included, so a Location the operator never saw would
    be handed the fleet admin token.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


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
    # Fall back to the hub, which holds credentials for every node. Both auth
    # branches pin the collector's known-hosts file, because a node's root
    # password must never be offered to a host that has not been verified.
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
        "      ['sshpass','-e','ssh','-o','StrictHostKeyChecking=yes',\n"
        "       '-o','UserKnownHostsFile=/opt/tono-ops/tono-collector-known-hosts'])\n"
        "base += ['-o','LogLevel=ERROR','-o','ConnectTimeout=15','-p',str(n.get('port',22)),\n"
        "         '%s@%s' % (n.get('user','root'), n['host'])]\n"
        f"r=subprocess.run(base+[{script!r}],capture_output=True,text=True,timeout=40,env=env)\n"
        "print('__HOST_KEY_UNPINNED__' if 'Host key verification failed' in r.stderr\n"
        "      else (r.stdout.strip() or '__UNREACHABLE__'))\n"
        "PY", timeout=90)
    if "__HOST_KEY_UNPINNED__" in out:
        return False, HOST_KEY_UNPINNED
    if "__NOT_REGISTERED__" in out or "__UNREACHABLE__" in out or not out:
        return False, out
    return True, out


def unquoted(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def catalog_proxies(text: str) -> list[tuple[str, list[str]]]:
    """Every published proxy, as (name, the lines of its entry).

    Scanned as text, never parsed: `{{TONO_CLIENT_UUID}}` is valid YAML
    flow-mapping syntax, so a parser turns every per-account placeholder into a
    nested mapping and the placeholder check below would never see one again.

    Only the entries under the top-level `proxies:` key count. A proxy group can
    carry the same name as a node, and reading one as a node reports a node with
    no credentials at all.

    An entry starts at a dash written at the list's own indent, not at a `name:`.
    Nothing orders the keys of a mapping, `publish-managed-catalog.rb` ships a
    node written `- type: vless` and one written as a single flow mapping, and
    an entry only recognised by its first key gets folded into the entry above
    it — which is how the next node's Reality credentials get reported as this
    node's.
    """
    entries: list[list[str]] = []
    current: list[str] | None = None
    item_indent: int | None = None
    in_proxies = True
    for line in text.splitlines():
        if re.match(r"[^\s#-][^:]*:", line):
            in_proxies = line.split(":", 1)[0].strip() == "proxies"
            current = None
            item_indent = None
            continue
        if not in_proxies or not line.strip() or line.lstrip().startswith("#"):
            continue
        head = re.match(r"( *)-\s", line)
        if head and item_indent is None:
            item_indent = len(head.group(1))
        if head and len(head.group(1)) == item_indent:
            current = []
            entries.append(current)
        if current is not None:
            current.append(line)

    named: list[tuple[str, list[str]]] = []
    for lines in entries:
        name = ""
        for line in lines:
            found = re.search(r"(?:^\s*-?\s*|[{,]\s*)name:\s*([^,}]*)", line)
            if found:
                name = unquoted(found.group(1))
                break
        named.append((name, lines))
    return named


def catalog_lookup(text: str, name: str) -> tuple[list[list[str]], list[str]]:
    """The entries published under exactly this name, and the near misses.

    This used to be a substring test and an `index()` into the raw document, so
    auditing a node whose name is a prefix of another node's name read the other
    entry — and then reported that other machine's Reality credentials as this
    one's match. A name that only nearly matches is returned rather than
    resolved, because the catalog and the hub registry disagreeing about a name
    is a real fleet condition and the operator has to see it.
    """
    proxies = catalog_proxies(text)
    exact = [lines for published, lines in proxies if published == name]
    near = sorted({published for published, _ in proxies
                   if published and published != name
                   and (name in published or published in name)})
    return exact, near


def catalog_fields(lines: list[str]) -> dict[str, str]:
    """The credentials of one entry, whether it is written as a block or as a
    single flow mapping. The publisher ships both, and an entry read as carrying
    no uuid reports a node published without a per-account identity.
    """
    fields: dict[str, str] = {}
    for line in lines:
        body = line.strip()
        if body.startswith("-"):
            body = body[1:].strip()
        # Split only a flow mapping. A block value is left whole: `{{TONO_CLIENT_UUID}}`
        # ends in braces of its own, and trimming those loses the placeholder.
        pairs = body[1:-1].split(",") if body.startswith("{") and body.endswith("}") else [body]
        for pair in pairs:
            key, separator, value = pair.partition(":")
            if separator and key.strip() in (
                "uuid", "public-key", "short-id", "servername", "port", "server"
            ):
                fields[key.strip()] = unquoted(value)
    return fields


def front_verdict(host: str) -> tuple[bool | None, str]:
    """Whether this Reality front was measured usable from inside the market.

    Nothing else here can tell: the catalog `servername` and the box's
    `serverNames` are compared against each other, so a front no customer can
    reach is consistent everywhere and reports green.
    """
    host = host.strip().lower()
    if any(host == domain or host.endswith(f".{domain}") for domain in REALITY_FRONTS["unusable"]):
        return False, f"{host} does not complete a handshake from inside the market"
    if host in REALITY_FRONTS["usable"]:
        return True, host
    return None, f"{host} has not been measured from inside the market"


def metering_rows(host: str) -> list[tuple[str, bool | None, str]]:
    """Whether this node can bill anybody, and whether it is billing.

    Every other check here passes on a node that meters nothing, and five nodes
    carried customer traffic for weeks in exactly that state. Configuration is
    not enough on its own — a management interface that answers nothing reads
    from the control plane exactly like an exit with no accounts on it — and
    neither is a live interface, because a stopped agent reports zero for
    everyone just as convincingly.
    """
    label = "metering (usage can be attributed)"
    sub = "  └ counters above zero and the agent reporting"
    ok, out = node(host,
        "X=/opt/tono-xray/current/xray; A=up; "
        # The reachability probe enable-tono-exit-metering.sh runs after it
        # restarts the service, and the older fleet name for it. --reset=false
        # because the agent bills the delta between reads: a read that zeroed the
        # counters would forgive everything used since its last run.
        f"S=$(\"$X\" api statsquery --server={METER_API} --reset=false 2>/dev/null) || "
        f"S=$(\"$X\" api stats --server={METER_API} --reset=false 2>/dev/null) || A=down; "
        "C=$(python3 -c \"import json;c=json.load(open('/opt/tono-xray/current/config.json'));"
        "l=((c.get('policy') or {}).get('levels') or {}).get('0') or {};"
        "s=(c.get('api') or {}).get('services') or [];"
        "print(','.join([n for n,present in ("
        "('stats-options', l.get('statsUserUplink') and l.get('statsUserDownlink')),"
        "('api-services', set(['HandlerService','StatsService'])<=set(s)),"
        "('api-inbound', any(i.get('port')==10085 and str(i.get('listen','')).startswith('127.') "
        "for i in c.get('inbounds') or []))) if not present]) or 'ok')\" 2>/dev/null); "
        "[ -n \"$C\" ] || C=unreadable; "
        # `u:` because that is the only label services/exit-agent bills: it drops
        # every counter whose label lacks that prefix, so the shared pre-account
        # client's bytes are attributed to nobody. Counting them here would report
        # a metering node on exactly the traffic that reaches no invoice.
        "N=$(printf '%s' \"$S\" | python3 -c \"import json,re,sys;d=json.load(sys.stdin);"
        "print(sum(1 for x in (d.get('stat') or []) "
        "if re.match('^user>>>u:.+>>>traffic>>>(up|down)link$', str(x.get('name',''))) "
        "and str(x.get('value','0')).isdigit() and int(x.get('value','0'))>0))\" 2>/dev/null); "
        "[ -n \"$N\" ] || N=unreadable; "
        f"G=$(python3 -c \"import os,time;print(int(time.time()-os.path.getmtime('{METER_STATE}')))\" 2>/dev/null); "
        "[ -n \"$G\" ] || G=never; "
        "printf '%s %s %s %s' \"$A\" \"$C\" \"$N\" \"$G\"")
    fields = out.split() if (ok and out and "__" not in out) else []
    if len(fields) != 4:
        # A failure, not an unknown. This runs only after the same box answered
        # the round-trip above, so a probe that comes back unreadable is a node
        # whose metering nobody can demonstrate — which is the state this exists
        # to stop reading as fully onboarded.
        why = out if out == HOST_KEY_UNPINNED else "could not read the box"
        return [(label, False, why), (sub, False, why)]
    answering, config, counted, age = fields

    if config == "unreadable":
        detail = "could not read config.json"
    elif config != "ok":
        detail = f"config.json is missing {config.replace(',', ' and ')}"
    elif answering != "up":
        detail = f"configured, but the stats API did not answer on {METER_API}"
    else:
        detail = f"stats API answers on {METER_API}"
    rows = [(label, config == "ok" and answering == "up", detail)]

    billing = counted.isdigit() and int(counted) > 0
    reporting = age.isdigit() and int(age) <= METER_STATE_MAX_AGE
    if not counted.isdigit():
        detail = "no counters could be read"
    elif not billing:
        detail = "every per-account counter is zero"
    elif not age.isdigit():
        detail = f"{counted} counter(s) above zero, but {METER_STATE} is absent"
    else:
        detail = (f"{counted} counter(s) above zero, agent reported {age}s ago"
                  + ("" if reporting else "  <-- stale"))
    rows.append((sub, billing and reporting, detail))
    return rows


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__.strip())
        return 2
    name, host = sys.argv[1], sys.argv[2]
    results: list[tuple[str, bool | None, str]] = []
    cat_entry: dict[str, str] = {}

    token = keychain(ADMIN_KEYCHAIN)
    try:
        # The admin token stays in a request header inside this process: argv is
        # readable by anything else running as this user.
        req = urllib.request.Request(
            f"{CONTROL_PLANE}/api/v1/admin/exit-catalog",
            headers={"Accept": "application/json"})
        req.add_unredirected_header("Authorization", f"Bearer {token}")
        with urllib.request.build_opener(NoRedirect).open(req, timeout=25) as resp:
            raw = resp.read().decode()
        cat = json.loads(raw)
        exact, near = catalog_lookup(cat.get("yaml", ""), name)
        if len(exact) == 1:
            detail = f"revision {cat.get('revision')}"
        elif len(exact) > 1:
            detail = f"{len(exact)} entries are published under this exact name"
        elif near:
            detail = "not published under this exact name; the catalog has " + ", ".join(near)
        else:
            detail = "not in the published catalog"
        results.append(("catalog (customers can select it)", len(exact) == 1, detail))
        if len(exact) == 1:
            # Every entry must carry the placeholder or that node serves one shared identity.
            cat_entry = catalog_fields(exact[0])
            ok = cat_entry.get("uuid") == "{{TONO_CLIENT_UUID}}"
            results.append(("  └ per-account identity placeholder", ok,
                            cat_entry.get("uuid", "?") if not ok else "{{TONO_CLIENT_UUID}}"))
            if cat_entry.get("servername"):
                results.append(("  └ reality front usable from inside the market",
                                *front_verdict(cat_entry["servername"])))
    except Exception as exc:
        results.append(("catalog (customers can select it)", None, f"could not read: {type(exc).__name__}"))

    reg = hub("python3 -c \"import json;d=json.load(open('/opt/tono-ops/nodes.secrets.json'));"
              f"n=[x for x in d['nodes'] if x.get('host')=='{host}'];"
              "print('yes' if n else 'no', (n[0].get('key') and 'key-auth' or 'password-auth') if n else '')\"")
    results.append(("ops hub registry (receives accounts)", reg.startswith("yes"), reg[4:].strip() or "absent"))

    # Recency, not a total. A node that died months ago still has thousands of
    # historical passes in this log, so counting them answers nothing — the
    # question is whether the sync reached it in the last few minutes.
    # Recency against the *registry* name looked up by host, because a total
    # counts a long-dead node as healthy, and the catalog name is not always the
    # registry name — the catalog says "Los Angeles · Lagoon" where the registry
    # and this log say "Los Angeles · Lagoon（家宽测试）". Matching the catalog
    # name reported a node syncing every minute as never synced.
    synced = hub("python3 - <<'PY'\n"
                 "import json, re, time, datetime\n"
                 "reg = json.load(open('/opt/tono-ops/nodes.secrets.json'))['nodes']\n"
                 f"m = [x for x in reg if x.get('host') == {host!r}]\n"
                 "if not m:\n"
                 "    print('unregistered')\n"
                 "    raise SystemExit\n"
                 "target = 'sync ' + m[0]['name'] + ':'\n"
                 "last = None\n"
                 "try:\n"
                 "    for line in open('/var/log/tono-ops-sync.log', errors='replace'):\n"
                 "        if target not in line or 'managed=' not in line: continue\n"
                 "        g = re.match(r'(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z)', line)\n"
                 "        if g: last = g.group(1)\n"
                 "except OSError:\n"
                 "    pass\n"
                 "if not last:\n"
                 "    print('never')\n"
                 "else:\n"
                 "    ts = datetime.datetime.strptime(last, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=datetime.timezone.utc).timestamp()\n"
                 "    print(('fresh ' if ts >= time.time() - 900 else 'stale ') + str(int(time.time() - ts)))\n"
                 "PY")
    fresh = synced.startswith("fresh")
    if synced.startswith("never"):
        detail = "no successful pass in the log"
    elif synced.startswith("unregistered"):
        detail = "not in the hub registry"
    else:
        detail = f"last sync {synced.split()[-1]}s ago" + ("" if fresh else "  <-- stale")
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

    # The catalog's Reality credentials must match what the box is running. This
    # is the check that catches a *reinstalled* node: everything above stays
    # green, the service is healthy, monitoring is happy — and every customer
    # who picks it fails, because the catalog still carries the old machine's
    # keys. It cost about 24 hours on Los Angeles · Pacific and raised no alarm
    # anywhere. The private key never leaves the host; only the derived public
    # key is compared, and that value is already public in the catalog.
    if cat_entry:
        ok_k, live = node(host,
            "X=/opt/tono-xray/current/xray; "
            "PRIV=$(python3 -c \"import json;c=json.load(open('/opt/tono-xray/current/config.json'));"
            "i=[x for x in c['inbounds'] if x.get('tag')=='tono-vless'][0];"
            "print(i['streamSettings']['realitySettings']['privateKey'])\"); "
            # Two Xray versions are in the fleet and they label this differently:
            # 25.3.6 prints "Public key:", 26.3.27 prints "Password (PublicKey):".
            # Matching only one left PUB empty, and the empty field then shifted
            # every later field along — reporting six healthy nodes as drifted.
            "PUB=$($X x25519 -i \"$PRIV\" 2>/dev/null | sed -n -e 's/^Password (PublicKey): //p' -e 's/^Public key: //p'); "
            "python3 -c \"import json,sys;c=json.load(open('/opt/tono-xray/current/config.json'));"
            "i=[x for x in c['inbounds'] if x.get('tag')=='tono-vless'][0];"
            "r=i['streamSettings']['realitySettings'];"
            "print('|'.join([sys.argv[1], str(i['port']), ','.join(r['shortIds']), ','.join(r['serverNames'])]))\" \"$PUB\"")
        f = live.split("|") if (ok_k and live and "__" not in live) else []
        if len(f) == 4 and all(x.strip() for x in f):
            live_pub, live_port, live_sids, live_sni = f
            for label, want, got, hay in (
                ("reality public key", cat_entry.get("public-key"), live_pub, None),
                ("reality short-id", cat_entry.get("short-id"), None, live_sids.split(",")),
                ("reality servername", cat_entry.get("servername"), None, live_sni.split(",")),
                ("port", cat_entry.get("port"), live_port, None),
            ):
                good = (want == got) if hay is None else (want in hay)
                shown = (got if hay is None else ",".join(hay))
                results.append((f"  └ catalog {label} matches the box", good,
                                "matches" if good else f"catalog={want} box={shown}"))
        else:
            # Padding a short record is what caused the false drift report, so a
            # record that is not exactly four non-empty fields is refused rather
            # than interpreted.
            why = "could not read the box" if not f else f"unreadable record: {len(f)} field(s)"
            results.append(("  └ catalog credentials match the box", None,
                            live if live == HOST_KEY_UNPINNED else why))

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
        results.extend(metering_rows(host))
    else:
        results.append(("node itself", False,
                        out if out == HOST_KEY_UNPINNED else "unreachable over SSH from here and from the hub"))

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
