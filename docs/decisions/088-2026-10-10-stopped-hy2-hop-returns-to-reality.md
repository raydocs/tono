## 2026-10-10 · What a stopped automatic hy2 attempt does to the Windows hy2 auto-switch
- Status: provisional (Windows mainland-China connectivity audit, while the owner was asleep; the owner may revisit)
- Chosen: an automatic ` · hy2` attempt ([decision 083](083-2026-10-10-hy2-auto-switch-windows-client.md)) that ends
  `Stale` before Connected — Disconnect, Quit, sign-out, an update, or the connect timeout superseding it — drops the
  hop for that node: the remembered 24 h choice and the Reality failure count are cleared, so the next unarmed attempt
  dials the selected Reality block. No backoff starts (a stop is not evidence hy2 failed), so a new run of 3 Reality
  failures may switch again at once. A stopped Reality attempt, a hand-picked ` · hy2` row and the live in-place
  session (`live_dial` under an armed barrier) are unchanged. Rejected: leaving the state as it was (before this, a
  stop changed nothing, so on a network that drops UDP every connect the user gave up on dialed hy2 again for up to
  24 h — the hang never reaches the failure path that sends the node back to Reality).
- Why stricter: it moves toward the default Reality block ("keep hy2 stripped"), never toward hy2; no new protocol,
  port, permit, node or identity, and the A18 grant and the pre-tunnel recheck are unchanged. Cost: a user whose
  Reality path is blocked and who stops a working-but-slow hy2 attempt pays 3 Reality failures before the next hop.
- Abort path: a stop that aborts the registered task running the attempt (`invalidate_connection`) drops it before
  any outcome; the same settlement then runs in `invalidate_connection`, under the lock, before the abort.
- Applied in: [#1532](https://github.com/raydocs/tono/pull/1532), `amp/win-hy2-stopped-hop` (`Hy2AutoSwitch::note_stopped`, `connection/heal.rs` `note_hy2_outcome`).
