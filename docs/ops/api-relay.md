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
scp tooling/ops/relay/tono-relay.stream.conf tooling/ops/relay/apply-relay.sh root@<node>:/root/
ssh root@<node> bash /root/apply-relay.sh
```

The script backs up `nginx.conf` to `nginx.conf.bak-<UTC>-pre-tono-relay-v2`, installs
`libnginx-mod-stream` if missing, reloads only when `nginx -t` passes, otherwise restores
the backup. Log: `/var/log/nginx/tono-relay.log` (only sessions that named an admitted SNI;
default nginx logrotate, daily, 14 kept). Errors: `/var/log/nginx/tono-relay-error.log`.

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

## Rollback

On the node: restore the latest `/etc/nginx/nginx.conf.bak-*-pre-tono-relay*` over
`/etc/nginx/nginx.conf`, `nginx -t`, `systemctl reload nginx`. Clients then fail over the
relay within their connect budget (Windows 4 s, macOS 5 s) and behave as before the relay.
