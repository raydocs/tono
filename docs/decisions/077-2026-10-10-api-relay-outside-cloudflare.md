## 2026-10-10 · Sign in through a Tono-owned API relay when Cloudflare is unreachable
- Status: owner (approach in chat 2026-10-09/10: "嗯我感觉这样可以", host choice "这里面有两台 dmit 你放一台"; follow-ups incl. second node, releases SNI and client path header confirmed 2026-10-10: "继续做 123456")
- Chosen: a TCP relay on the Tono node "Los Angeles · Westwood" (DMIT, 179.253.233.220,
  CN-optimised transit), nginx `stream` with `ssl_preread` on port 2053, admitting exactly
  the SNI `api.afk.ccwu.cc` and forwarding the unterminated TLS session to the Cloudflare
  edge (104.20.26.170:443, backup 172.66.162.98:443); every other SNI is sent to a closed
  port. The Windows client tries the compiled relay list (`bootstrap::API_RELAYS`) only
  after the pinned addresses and the system resolver have both failed provably
  undelivered, before DoH and the alternate ports, and goes to a relay that answered first
  for the rest of the process. Rejected: terminating TLS on the node with a Tono
  certificate (the node would hold a key and see plaintext); a relay list fetched from the
  API (useless for a first sign-in, which is the failing case); adding the relay to the
  WFP bootstrap permit (widens the armed kill switch to a non-Cloudflare address).
- Owner, 2026-10-09/10: "我还有服务器dmit 三网优化的" and "这里面有两台 dmit 你放一台"
  (I also have CN-optimised DMIT servers; put it on one of the two). The approach itself
  was approved 2026-09-29 ("按 2 开始修") and not shipped then.
- Why stricter: TLS stays end to end and the client validates the same Cloudflare
  certificate on every path; the relay sees SNI and ciphertext, as any router on the path
  does. The WFP permit is unchanged, so while protection is armed the relay is simply
  blocked like any other non-permitted address: it can add a sign-in, never a leak.
  Exposure added: the relay's access log holds client IP, SNI, byte counts and session time
  (14-day logrotate on the node); the control plane sees the relay's IP as the client's
  edge IP for relayed requests, so `edge_asn`/`edge_country` on their events describe the
  node, not the customer.
- Evidence: the affected customer is on China Mobile Shanghai (ASN 38019, D1 read-only);
  TCP 443 to the pin succeeds from China Mobile probes (~190 ms) and HTTPS to the API host
  succeeds from 28/36 China Telecom/Unicom probes, so the SNI is not blocked and the
  failure is the carrier's path to Cloudflare. The relay port answers from every mainland
  probe (China Mobile 139–142 ms).
- Rollback on the node: restore `/etc/nginx/nginx.conf.bak-20261010T030419Z-pre-tono-relay`
  over `/etc/nginx/nginx.conf`, `nginx -t`, `systemctl reload nginx`. `tono-xray` was not
  touched (it owns 443).
- Applied in: PR fix/win-api-relay-20261010 (`apps/windows/app/src-tauri/src/tono/{bootstrap,transport}.rs`);
  changelog [2026-10-10-win-api-relay.md](../changelog.d/2026-10-10-win-api-relay.md);
  finding [WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md). macOS: PR
  fix/mac-api-relay-20261010 (`apps/macos/Tono/Services/{ControlPlanePath,TonoAPIClient}.swift`,
  `ControlPlanePath.apiRelays`, tried after the system resolver and the pinned addresses both
  fail before any request byte; not in the PF bootstrap permit); changelog
  [2026-10-10-mac-api-relay.md](../changelog.d/2026-10-10-mac-api-relay.md). Follow-ups
  2026-10-10 (second relay Mesa 179.255.154.17:2053, `releases.afk.ccwu.cc` SNI, `X-Tono-Path`
  header recorded per device, relay probe cron): runbook [docs/ops/api-relay.md](../ops/api-relay.md);
  changelog [2026-10-10-api-relay-followups.md](../changelog.d/2026-10-10-api-relay-followups.md).
