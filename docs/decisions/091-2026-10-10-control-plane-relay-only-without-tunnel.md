## 2026-10-10 · Without a healthy tunnel, control-plane requests go to the Tono relays only (amends 077/086/090 path order)
- Status: provisional (owner direction via Puck 2026-10-10, relayed by the coordinator of the Amp backlog session;
  recorded here by the implementing agent)
- Question: decisions 077, 086 and 090 tried the Tono API relays after the Cloudflare paths (pins, system resolver), or
  armed only on macOS. For the customer the relays exist for (carrier path to Cloudflare broken), every request without
  a tunnel paid the dead Cloudflare connect budgets first: on Windows the relays started about 20 s in (pinned 10 s +
  system resolver 10 s), and a third relay about 28 s in, against a 30 s launch restore budget.
- Chosen: without a healthy tunnel (first sign-in, token refresh, catalog and entitlement checks, Protected Offline, drop
  recovery), a request to the production API host goes to the relays only, in the compiled order with the relay that
  last answered first. No Cloudflare system-DNS attempt, no pinned-address attempt, no DoH, no alternate port, no
  "tunnel already up" step. When every relay fails, the request fails with an error naming every relay and how it
  failed; there is no automatic direct fallback. With a healthy tunnel the path order is unchanged (the tunnel carries
  the direct path). A POST or DELETE moves to the next relay only after a failure that proves nothing was delivered.
  TLS keeps the real hostname, SNI and default certificate validation; relays pass TLS through; nothing about auth
  moves to the relay. VPN payload never goes through the relays.
  Rejected: relays first with the direct paths as a bounded fallback (superseded: it still pays the dead paths when the
  relays are down, and armed it is blocked anyway); racing paths in parallel (duplicate POST/refresh side effects).
- Exceptions:
  1. Legacy Service gate (Windows): armed without a tunnel on a Service that does not report the WFP relay permit
     (protocol revision < 20; decision 090 shipped the permit at revision 19 without reporting it), the full walk stays:
     that Service's rule C permits the pins and not the relays. Unarmed there is no WFP, so relay-only applies.
  2. A base URL whose host the relays do not serve (integration profile, tests): the full walk.
  3. The Windows updater (`commands/update.rs`, relay-first since A1) is unchanged: it GETs another host
     (`releases.afk.ccwu.cc`) through its own walk, so this predicate is not trivially the same.
- Platforms:
  - Windows: `apps/windows/app/src-tauri/src/tono/transport.rs` (`relays_only`, `send_over_relays`). The state comes from
    the connection state machine and the Service's last kill-switch reading (`control_plane_reach_of`), published to the
    transport on every status publication (`commands::status_of`). A tunnel is: connected, a connect past
    `LockingTraffic` (the Service may already be `Locked`, which retracts rule C), or a disconnect whose last reading is
    still `Locked`. Each relay has `RELAY_CONNECT_TIMEOUT` (4 s) to connect and the shared 45 s total; three dead relays
    cost at most 12 s of connecting, and a live third relay is reached by about 8 s. The state is read again before
    every non-relay step, so a tunnel lost mid-walk skips the remaining direct steps for the relays.
  - macOS: see the macOS PR.
- Why stricter: armed, the relays are already the only non-tunnel destinations rule C (Windows, decision 090) and the PF
  permit (macOS, decision 086) need; unarmed, the client stops sending the API host's SNI to Cloudflare from networks
  where that path is broken and falls back to nothing it was not already using. No permit, port or host is added.
- Exposure: a relay operator sees client IP, SNI, sizes and timing for every request without a tunnel (as 077 records),
  not only for those whose Cloudflare paths failed. If every relay is down, the control plane is unreachable without a
  tunnel (sign-in, refresh and catalog recovery fail with the relay error) until a relay recovers.
- Applied in: Windows PR `amp/win-relay-only-without-tunnel`; changelog
  [2026-10-10-win-relay-only-without-tunnel.md](../changelog.d/2026-10-10-win-relay-only-without-tunnel.md); runbook
  [docs/ops/api-relay.md](../ops/api-relay.md).
