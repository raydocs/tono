# API relay (decisions 077, 089)

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
| San Jose · Uscloud (AS402169) | 38.14.195.144 | 2053 | 2026-10-10 (node side; see below) |

Westwood and Mesa are exit nodes; `tono-xray` owns 443 and is never touched. Admitted SNIs:
`api.afk.ccwu.cc` (control plane), `releases.afk.ccwu.cc` (installers). Anything else is
sent to a closed port.

Clients walk the relays in the table's order. The third is appended last so a walk that
reaches a DMIT relay is unchanged and a remembered relay index (Windows) keeps its meaning.

### San Jose · Uscloud (decision 089)

- **Failure domain.** Uscloud Inc (AS402169), San Jose: another provider, ASN and city than
  the two DMIT nodes (both DMIT, Los Angeles), so one provider's outage or one city's transit
  problem no longer takes every relay down. Not CN-optimised transit like the DMIT pair:
  expect a higher round trip from mainland carriers.
- **Not an exit node.** No `tono-xray`, no exit agent, no `exit_nodes` row. It carries only the
  relay.
- **Deploy.** Done by the coordinator session on 2026-10-10 (owner-approved via Puck the same
  day): nginx `stream` + `ssl_preread` with the same SNI map and Cloudflare upstream as
  [`tono-relay.stream.conf`](../../tooling/ops/relay/tono-relay.stream.conf), TLS passed
  through unterminated, logs and 14-day rotation as below.
- **Limits on this node** (in addition to the canonical file, which the DMIT nodes run without):
  `limit_conn` 64 per client IP; nginx's systemd unit capped at `MemoryMax=256M`,
  `CPUQuota=100%`, `TasksMax=64`, `LimitNOFILE=8192`; logrotate 14 days. These live only on
  the node today; they are not in the canonical file, so `apply-relay.sh` on this node would
  replace the stream config without the `limit_conn` line. Re-apply them by hand after any
  `apply-relay.sh` run here until they are committed.
- **Rollback.** `/root/tono-relay-rollback.sh` on the node restores the pre-relay nginx state.
  Clients then fail over the third relay within its connect budget, as for any dead relay.
- **Status 2026-10-10: not reachable from outside.** The relay answers locally on the node,
  but the provider's network firewall drops inbound TCP 2053 (Globalping TCP 2053: 100 %
  loss from US, DE and CN probes while 443 on the same address connects). The owner must
  open 2053 in the provider's panel. Until then, clients that reach this relay pay its
  connect budget and move on; the Worker probe reads it as down. External acceptance
  (below, "Verify") must pass before the client change merges.
- **End-to-end monitoring gap.** The node-side probe (below) reports with an exit agent's
  node token, and this host has none, so `api-relays.ts` gives it no `exitNodeId`: no report
  is accepted for it, the console's "端到端可用" column stays 「节点未上报」, and alerts judge it on
  the Worker's TCP-open probe alone. An open port does not prove the SNI pass-through reaches
  the API. Closing the gap needs a relay-only credential (or an exit agent on the host);
  neither exists yet. Until then, check it by hand with the "Verify" commands.

The same list, in the same order, is compiled into the clients and the control plane; change
all four together:
`apps/windows/app/src-tauri/src/tono/bootstrap.rs` (`API_RELAYS`),
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
openssl s_client -connect <node>:2053 -noservername </dev/null 2>&1 | grep -c 'BEGIN CERTIFICATE'  # 0, no SNI is closed too
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
the node's `exit_nodes.id` is not the relay's `exitNodeId`. Rollback:
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

## Client behaviour

Windows (`transport.rs`) and macOS (`TonoAPIClient.exchangeOverPaths`) try a relay only after
the pinned Cloudflare addresses and the system resolver have both failed before any request
byte was sent, so a sign-in code is never sent twice. A relay that answered is tried first
afterwards (Windows: for the process; macOS: for 24 h via the app profile). Every attempt
carries `X-Tono-Path: <pinned|system_dns|relay|doh|alt_port|tunnel>`, which the control plane
records on the device row, because a relayed request otherwise looks like one from an exit
node. The relay is **not** in the WFP/PF bootstrap permit: while protection is armed it is
blocked like any other non-permitted address.

Updater: Windows (`commands/update.rs` `get_with_relays`) sends a discovery, signature or
package GET through the relays when the direct GET got no response. macOS does the same:
`NativeUpdateDownload.bounded` for the manifest and signature GETs (backlog A2), and
`NativeUpdateDownload.package(at:size:)` for the package, streamed to disk under the signed
size with the direct download's 60 s idle and 900 s total budgets (A2 follow-up). Any status
line is the answer and is not sent again on another path.

### Connect budgets with three relays

Each relay gets a bounded connect (TCP and TLS) budget; a relay that answers ends the walk.

| Client | Per relay | Whole walk (three dead relays) |
|---|---|---|
| Windows API transport and updater (`RELAY_CONNECT_TIMEOUT`) | 4 s | 12 s |
| macOS API exchange (`PinnedControlPlaneExchange.relayWalkBudget`) | 5 s | 15 s (a relay that fails sooner leaves its rest to the next) |
| macOS updater package GET (`relayConnectBudget`) | 5 s | 15 s |
| Pre-login handshake probe (both) | parallel | 5 s (macOS `ControlPlaneHandshake.budget`) |

Before the third relay the macOS API exchange split one 5 s budget across all relays; with
three, a relay that drops packets would have left the next only 1.7 s, too little for the
San Jose relay's longer mainland round trip. The walk runs only after every direct
Cloudflare path failed undelivered, or first when a relay answered before (Windows remembers
which one; macOS remembers only "relay", so a dead Westwood costs a relayed Mac up to 5 s per
request until it recovers).

## Rollback

On the node: restore the latest `/etc/nginx/nginx.conf.bak-*-pre-tono-relay*` over
`/etc/nginx/nginx.conf`, `nginx -t`, `systemctl reload nginx` (San Jose ·
Uscloud: `/root/tono-relay-rollback.sh`). Clients then fail over the relay within their
connect budget (above) and behave as before the relay.
