# API relay (decision 077)

Tono-owned TCP relays outside Cloudflare for clients whose carrier path to the Cloudflare
edge is broken (first case: China Mobile Shanghai, 2026-10-10). The relay is nginx
`stream` with `ssl_preread`: it reads the SNI, admits only the listed Tono hosts and
forwards the **unterminated** TLS session to the Cloudflare edge. No certificate or key on
the node; the client validates the normal Cloudflare certificate.

## Nodes

| Node | Address | Port | Since |
|---|---|---|---|
| Los Angeles · Westwood (DMIT) | 179.253.233.220 | 2053 | 2026-10-10 03:04 UTC |
| Los Angeles · Mesa (DMIT) | 179.255.154.17 | 2053 | 2026-10-10 03:59 UTC |

Both are exit nodes; `tono-xray` owns 443 and is never touched. Admitted SNIs:
`api.afk.ccwu.cc` (control plane), `releases.afk.ccwu.cc` (installers). Anything else is
sent to a closed port.

### Common-failure risk (open)

Both relays sit at one provider in one city: ipinfo on 2026-10-10 reports **AS906 DMIT Cloud
Services, Los Angeles** for 179.253.233.220 and for 179.255.154.17 (hostname `host-by.dmit.com`,
same postal code). Different hosts protect against one VM failing, not against a DMIT network or
data-centre outage, a DMIT route change towards Chinese carriers, or a block of DMIT's address
space; any of those takes both relays down together, and clients fall back to today's
behaviour (no relay). Owner action: add a relay on a different provider and region
(different ASN, ideally not Los Angeles) and list it in all four places below. Nothing has been
bought or deployed for this. Finding [API-RELAY-SAME-PROVIDER](../findings.d/API-RELAY-SAME-PROVIDER.md).
A field check of both relays from a mainland network: [cn-acceptance.md](cn-acceptance.md) (3c, 4.x).

The same list is compiled into the clients and the control plane; change all four together:
`apps/windows/service/src/lib.rs` (`API_RELAYS`, re-exported by the Windows app's
`bootstrap.rs` and rendered into WFP rule C; a change there changes the kill switch permit
table and its pinned test, decision 090),
`apps/macos/Tono/Services/ControlPlanePath.swift` (`apiRelays`),
`services/control-plane/src/api-relays.ts` (probe list), this file.

## Config

Canonical file: [`tooling/ops/relay/tono-relay.stream.conf`](../../tooling/ops/relay/tono-relay.stream.conf),
installed as `/etc/nginx/tono-relay.stream.conf` and included from the `stream {}` block in
`/etc/nginx/nginx.conf`. Apply or update with
[`tooling/ops/relay/apply-relay.sh`](../../tooling/ops/relay/apply-relay.sh):

```sh
scp tooling/ops/relay/tono-relay.stream.conf tooling/ops/relay/tono-relay.logrotate tooling/ops/relay/apply-relay.sh root@<node>:/root/
ssh root@<node> bash /root/apply-relay.sh                    # nginx + log rotation
ssh root@<node> bash /root/apply-relay.sh --logrotate-only   # log rotation only, nginx untouched
```

The script backs up `nginx.conf` to `nginx.conf.bak-<UTC>-pre-tono-relay-v2`, installs
`libnginx-mod-stream` if missing, reloads only when `nginx -t` passes, otherwise restores
the backup. Log: `/var/log/nginx/tono-relay.log` (only sessions that named an admitted SNI).
Errors: `/var/log/nginx/tono-relay-error.log`.

### Log rotation

Canonical file: [`tooling/ops/relay/tono-relay.logrotate`](../../tooling/ops/relay/tono-relay.logrotate),
installed as `/etc/logrotate.d/00-tono-relay` (mode 0644): both relay logs daily, 14 kept,
`dateext` (`tono-relay.log-YYYYMMDD`), `compress` + `delaycompress`, `missingok`, `notifempty`,
then `invoke-rc.d nginx rotate` (USR1, nginx reopens its logs), as the distro nginx package does.

The distro's `/etc/logrotate.d/nginx` (Debian/Ubuntu `nginx-common`: `/var/log/nginx/*.log`, daily,
14 kept, no `dateext`) also matches both files, and logrotate fails the run with `duplicate log
entry` when two stanzas claim one file. logrotate reads `/etc/logrotate.d` in name order, so the
`00-` prefix puts the Tono stanza first and its `ignoreduplicates` makes the later distro glob skip
the two relay files; every other nginx log stays with the distro stanza, whose conffile is not
edited. `ignoreduplicates` needs logrotate 3.21+ (Debian 12/13, Ubuntu 24.04). On older logrotate
(Ubuntu 22.04: 3.19) the script skips the install and says so; the distro stanza then still
rotates the relay logs daily with 14 kept, only without `dateext`. After installing, the script
runs `logrotate -d /etc/logrotate.conf` and removes its file again if that reports an error for it
or a duplicate entry.

Check on the node: `logrotate -d /etc/logrotate.conf 2>&1 | grep -E 'tono-relay|duplicate'` (the
distro glob line shows `ignore duplicate log entry`), and after a day `ls /var/log/nginx/tono-relay.log-*`.
Numbered files the distro stanza rotated before the install (`tono-relay.log.1`, `.2.gz`, ...)
do not match the `dateext` pattern and are not pruned; delete them once by hand.
Undo: `rm /etc/logrotate.d/00-tono-relay` (the distro stanza takes the files back).

## Verify

From any machine outside the node:

```sh
curl -s -o /dev/null -w '%{http_code}\n' --resolve api.afk.ccwu.cc:2053:<node> https://api.afk.ccwu.cc:2053/api/v1/health      # 200
curl -s -o /dev/null -w '%{http_code}\n' -r 0-1023 --resolve releases.afk.ccwu.cc:2053:<node> https://releases.afk.ccwu.cc:2053/download/<file>  # 206
curl -s --max-time 6 --resolve example.invalid:2053:<node> https://example.invalid:2053/; echo $?  # 35, connection closed
```

Mainland reachability: `https://tcp.ping.pe/<node>:2053` (China Mobile / Telecom / Unicom
probe rows). The control plane's 5-minute cron also records a TCP-open probe per relay
(`api_relay_probes`, ops console Nodes page "API 中继", column "TCP 可达").

## End-to-end probe (node side)

The Worker cannot set SNI on a raw socket, so its probe only proves the port is open. Each
relay node therefore checks itself every 5 minutes:
[`tooling/ops/relay/relay-probe.py`](../../tooling/ops/relay/relay-probe.py) dials
`127.0.0.1:2053`, does TLS with SNI `api.afk.ccwu.cc` and **default certificate verification**
(system CA store, hostname check), sends `GET /api/v1/health` and requires the Worker's
`{"ok": true, "service": "api"}`. The equivalent by hand:

```sh
curl -s --resolve api.afk.ccwu.cc:2053:127.0.0.1 https://api.afk.ccwu.cc:2053/api/v1/health   # {"ok":true,...,"service":"api"}
```

It reports `{observedAt, httpStatus, latencyMs, error}` to `POST /api/v1/home/relay-probe` on
`TONO_API_BASE` directly (not through the relay, so a dead relay is still reported), with the
**exit agent's existing node token** from `/etc/tono-exit-agent/env`. No new credential: the
control plane maps the token's `exit_nodes.id` to the relay (`exitNodeId` in
`services/control-plane/src/api-relays.ts`: `los-angeles-westwood`, `los-angeles-mesa`), refuses
any other exit node (403 `NOT_AN_API_RELAY`), decides `ok` itself (2xx and no error) and keeps the
newest report in `api_relay_reports` (migration 0096). The console column "端到端可用" shows it
with its age; a report older than 15 minutes reads as stale, not as up.

Install (per relay node, as root; status 2026-10-10: **pending**, no SSH from the agent orb):

```sh
scp tooling/ops/relay/relay-probe.py tooling/ops/relay/tono-relay-probe.service \
    tooling/ops/relay/tono-relay-probe.timer root@<node>:/root/
ssh root@<node> '
  set -e
  grep -q "^TONO_HOME_AGENT_TOKEN=" /etc/tono-exit-agent/env   # the exit agent env must exist
  install -d -m 0755 /opt/tono-relay-probe
  install -m 0755 /root/relay-probe.py /opt/tono-relay-probe/relay-probe.py
  install -m 0644 /root/tono-relay-probe.service /root/tono-relay-probe.timer /etc/systemd/system/
  systemctl daemon-reload
  systemctl start tono-relay-probe.service && journalctl -u tono-relay-probe -n 3 --no-pager
  systemctl enable --now tono-relay-probe.timer && systemctl list-timers tono-relay-probe.timer --no-pager'
```

The first run must log `relay-probe: reported, HTTP 200`. A `report refused: HTTP 403` means
the node's `exit_nodes.id` is not the relay's `exitNodeId`.

Check the install (read-only, sends nothing; also after the log rotation install below):

```sh
scp tooling/ops/node-install/check-node-install.py root@<node>:/root/
ssh root@<node> python3 -I /root/check-node-install.py relay-probe relay-logrotate node-agent
```

[`check-node-install.py`](../../tooling/ops/node-install/check-node-install.py) prints one
`PASS` / `WARN` / `FAIL` line per check and exits 1 on any `FAIL`: files present, `root:root`, with
the install modes (script 0755, units 0644, `/etc/tono-exit-agent/env` 0600 and setting
`TONO_HOME_AGENT_TOKEN` and `TONO_API_BASE`), timer enabled and active, the service loaded and its
last run not failed, then one probe through `127.0.0.1:2053` with the installed script's own
`probe()` (printed, **not** reported). `relay-logrotate` checks `/etc/logrotate.d/00-tono-relay`
(0644, daily, 14, `ignoreduplicates`; on logrotate < 3.21 its absence is a `WARN`), `nginx -t` and
`logrotate -d`. Omit `node-agent` until that agent is installed. `--no-smoke` skips the probe,
`nginx -t` and `logrotate -d`. No line carries a token, a config value or file contents. Rollback:
`systemctl disable --now tono-relay-probe.timer`; nothing else on the node changes (nginx and
`tono-xray` are not touched).

## Alerts

Every ops verdict pass (`src/ops/relay-alerts.ts`) turns the two checks into one incident per
relay, kind `api-relay-down`, subject `fleet/<host>:<port>`, severity `warn`, sent through the
ordinary `ops_alert_rules` outbox:

- **Opens** when either signal has failed **3 consecutive checks**: the Worker's TCP probe, or
  the node's end-to-end report. For end to end only, a report older than 15 minutes (the
  console's 「上报过期」 line; three missed 5-minute reports) counts as tripped. A relay whose
  node has never reported has no end-to-end signal and is judged on TCP alone.
- **Clears** at the first check after which neither signal is tripped.
- The count is not stored: both checks run every 5 minutes and a success resets the row's
  `failing_since`, so the failures in the current run are `round((latest − failing_since) / 300) + 1`.
  No migration. A skipped cron tick inside a failing run still counts as a cadence.
- One message per transition: while the incident stays open nothing new is planned (the detail
  is refreshed in place), so a 4th failure sends nothing. Reopening needs 3 new failures.

Rules decide who hears it. Production's `Email: warn and above` (`fire_on=open`) already sends
the opening; a recovery message needs a rule with `fire_on=open_resolve`, and its
`cooldown_seconds` must be shorter than the outage or the recovery is suppressed as inside the
cooldown. Suggested rule (admin API, owner chooses the target):

```sh
curl -X POST https://admin.afk.ccwu.cc/api/v1/ops/alert-rules -H 'content-type: application/json' \
  -d '{"name":"API 中继","matchKind":"api-relay-down","minSeverity":"warn","fireOn":"open_resolve","cooldownSeconds":0,"channel":"email","target":"<address>"}'
```

With `cooldownSeconds: 0` a flapping relay can send at most one opening and one recovery per
15 minutes, because each reopening needs three fresh failed checks. Every matching rule sends its
own copy: with both rules the opening arrives twice and the recovery once.

The same rule from the ops console (owner, Access login): 设置 → 告警 (`https://admin.afk.ccwu.cc/ops/#/settings/alerts`)
→ 新建规则, then:

| Field | Value |
|---|---|
| 名称 | `API 中继` |
| 启用 | 开 |
| 最低严重度 | 注意 (`warn`; 严重 would never match, the relay incident is `warn`) |
| 最少影响人数 | `0` (the relay incident has no customer count) |
| 什么时候发 | 出事和恢复都发 (`open_resolve`) |
| 延迟几秒再发 | `0` |
| 冷却多少秒 | `0` (must be shorter than the outage, or the recovery is recorded 冷却中未发) |
| 通道 / 发到哪儿 | 邮件 and your address, or a webhook as for the other rules |
| 只看这类事 | `api-relay-down` |
| 只看这一个对象 | empty (one rule for both relays) |

Save, then 发送测试 to see the channel works. Check the result read-only with
[`check-relay-alert-rule.mjs`](../../tooling/scripts/check-relay-alert-rule.mjs), from either export
(the D1 query leaves out `target`, so no address lands in the file):

```sh
# ops API, Access session: GET https://admin.afk.ccwu.cc/api/v1/ops/alert-rules > /tmp/rules.json
# or a remote D1 read from services/control-plane with the tono profile:
npx wrangler d1 execute tono-control-plane --remote --json --command \
  "SELECT id, name, enabled, match_kind, match_subject_type, match_subject_id, min_severity, min_impact, fire_on, delay_seconds, cooldown_seconds FROM ops_alert_rules" > /tmp/rules.json
node tooling/scripts/check-relay-alert-rule.mjs /tmp/rules.json [--outage-seconds 300]
```

It prints `PASS` for each enabled rule whose match fields admit the relay incident with
`fire_on=open_resolve` and a cooldown shorter than the outage, `skip <id>: <reason>` for the rest,
and exits 0 only when one such rule covers every relay (`OK`), else 1 (`MISSING`). The default
outage, 300 s, is the shortest one that opens an incident: it resolves one 5-minute check later.

## Client behaviour

**Windows, decision 091** (supersedes the Windows half of the order below): without a healthy
tunnel (signed out, unarmed, armed without a tunnel, Protected Offline, drop recovery), a
request to the API host goes to the relays only (`transport.rs` `send_over_relays`): the relay
that last answered first, then the rest in `API_RELAYS` order, 4 s connect each
(`RELAY_CONNECT_TIMEOUT`), 45 s total. No pinned, system-resolver, DoH, alternate-port or
loopback-tunnel attempt, and no direct fallback: when every relay fails, the error is
`relay[<ip:port>: <phase>: <cause>; …]`, one entry per relay. Three dead relays cost at most
12 s of connecting; a live third relay is reached by about 8 s. Connected (or a connect past
`LockingTraffic`) the order is unchanged and the tunnel carries the direct path. Exceptions:
armed without a tunnel on a Service below protocol revision 20 (no reported relay permit) and
any host other than the API host keep the full walk below; the updater is unchanged.

Otherwise (Windows with a tunnel or under an exception; macOS per decision 086 and below),
Windows (`transport.rs`) and macOS (`TonoAPIClient.exchangeOverPaths`) try a relay only after
the pinned Cloudflare addresses and the system resolver have both failed before any request
byte was sent, so a sign-in code is never sent twice. A relay that answered is tried first
afterwards (Windows: for the process; macOS: for 24 h via the app profile). Every attempt
carries `X-Tono-Path: <pinned|system_dns|relay|doh|alt_port|tunnel>`, which the control plane
records on the device row, because a relayed request otherwise looks like one from an exit
node.

While protection is armed without a tunnel (bootstrap, Protected Offline):

- **Windows**: WFP rule C permits each relay `IP:2053`, TCP, for the installed Tono app only
  (the same `ALE_APP_ID` condition as the Cloudflare entries, which stay), so sign-in and
  refresh can go through a relay in that state too (owner decision W-A,
  [decision 090](../decisions/090-2026-10-10-windows-armed-control-plane-via-relays.md),
  amending 077). No other process matches; connected (`Locked`) the whole channel is
  retracted. A Service at protocol revision 20 or later reports the permit, and the app then
  goes relay-only in this state ([decision 091](../decisions/091-2026-10-10-control-plane-relay-only-without-tunnel.md)).
- **macOS**: the PF bootstrap permit does not include the relays on `main`; armed, a relay is
  blocked like any other non-permitted address (decision 086, PR #1507, changes this).

macOS sign-in budget, per walk (`TonoAPIClient.exchangeOverPaths`; `sendData` runs at most two
walks, 1 s apart, and only when the retry rule allows a second one):

| Path, in the usual order | Read (GET) | Mutating request (POST, DELETE) |
|---|---|---|
| `system_dns` (URLSession) | at most 15 s with no status line (`ControlPlanePath.systemHeadBudget`), then the next path | up to the session's 30 s request / 45 s resource timeout; moves on only after a failure that proves nothing was sent |
| `pinned` | 10 s connect, split across the addresses | same |
| `relay` | 5 s connect, split across both relays (a dead first relay leaves the second the rest) | same |

So when the pinned connects fail, a read reaches the relays at most 25 s after it starts, whatever
the system resolver does. A pinned address that accepts the connection and then never answers has no
head budget: the read waits for it up to the session's timeout, so the relays can start about 60 s in
(#1523 review minor M2, finding MAC-CP-PINNED-SILENT-WAIT).
A POST whose system attempt timed out is not re-sent, because it may have arrived. The client
handshakes every path straight away instead (no request, nothing identifying, as the pre-login
probe does), and the user's retry goes first to a path that completed TLS. A path remembered
from an earlier answer or probe goes first, so a network that needs the relays pays the dead
paths once per 24 h. After a connection is up, each exchange has 45 s.

Updater: Windows (`commands/update.rs` `get_with_relays`) sends a discovery, signature or
package GET through the relays when the direct GET got no response. macOS does the same:
`NativeUpdateDownload.bounded` for the manifest and signature GETs (backlog A2), and
`NativeUpdateDownload.package(at:size:)` for the package, streamed to disk under the signed
size with the direct download's 60 s idle and 900 s total budgets (A2 follow-up); once the
signed size is on disk, the 2 s wait for the connection's end decides and the total budget no
longer fails it (#1516 review M3). Any status
line is the answer and is not sent again on another path.

## Rollback

On the node: restore the latest `/etc/nginx/nginx.conf.bak-*-pre-tono-relay*` over
`/etc/nginx/nginx.conf`, `nginx -t`, `systemctl reload nginx`. Clients then fail over the
relay within their connect budget (Windows 4 s, macOS 5 s) and behave as before the relay.
