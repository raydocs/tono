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

The same list is compiled into the clients and the control plane; change all four together:
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
```

Mainland reachability: `https://tcp.ping.pe/<node>:2053` (China Mobile / Telecom / Unicom
probe rows). The control plane's 5-minute cron also records a TCP-open probe per relay
(`api_relay_probes`, ops console Nodes page "API 中继").

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
package GET through the relays when the direct GET got no response. macOS
(`NativeUpdateDownload.bounded`) does the same for the manifest and signature GETs only; the
package download stays direct (backlog A2).

## Rollback

On the node: restore the latest `/etc/nginx/nginx.conf.bak-*-pre-tono-relay*` over
`/etc/nginx/nginx.conf`, `nginx -t`, `systemctl reload nginx`. Clients then fail over the
relay within their connect budget (Windows 4 s, macOS 5 s) and behave as before the relay.
