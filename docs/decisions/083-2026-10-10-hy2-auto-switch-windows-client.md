## 2026-10-10 · How the Windows client moves on its own from a node's Reality block to its ` · hy2` block (A17)
- Status: provisional (backlog A17 Windows half, D1-C, while the owner was asleep; the owner may revisit)
- Chosen: the client moves only when this process has read a `GET /api/v1/exit-catalog` 200 for the signed-in
  device that carried `hy2AutoSwitch: true` (A18, [decision 079](079-2026-10-10-amp-backlog-defaults.md) D1-C).
  The field is read on every 200, including an unchanged install. Missing or `false`: Reality only, and every
  remembered choice, counter and backoff is cleared. The cached catalog never turns it on: after a restart nothing
  moves until the first live 200.
  After **3** consecutive Reality connect failures of the selected node that name its TCP path (pre-tunnel TCP proof
  failed, `tls handshake eof`, `CORE_EXIT_UNREACHABLE`, `TONO_NODE_OR_CORE_UNREACHABLE`; Service, WFP-engine, DNS
  preflight and sign-in failures neither count nor reset), the next connect attempt with no barrier up dials that
  node's ` · hy2` block. The block must have the exact name base + ` · hy2`, be admitted as hysteria2, have the same
  IPv4 as the Reality block and a password equal to its UUID (same Tono identity), and not be Tokyo (vendor drops
  inbound UDP). No other node is ever chosen. While this holds, the sticky healer stays on the selected node
  instead of moving to another node in the region; it moves on as before once the switch stops holding.
  An automatic hy2 attempt that reaches Connected (the same stages and readiness checks as a manual hy2 pick) is
  remembered for that node for **24 h** (`hy2-auto-switch.json` next to the catalog cache, base names and expiry
  only; deleted with the catalog at sign-out or account change). A dial from that memory, or an in-place reconnect,
  does not extend it, so Reality is tried again after 24 h. An automatic hy2 attempt that fails goes back to
  Reality, forgets the node, needs 3 new failures, and is blocked for that node for 30 min, doubling per further
  failure up to 6 h. The memory also clears when the node's hy2 block leaves the catalog or the user picks either
  block of that node by hand (including re-picking the row already selected), so the next dial is the picked block.
  The selection itself stays the Reality block; a hand-picked ` · hy2` row is never counted or changed.
  The grant is checked again right before the tunnel starts: if it was withdrawn (or the block changed) while the
  attempt waited, that attempt dials the selected Reality block instead, after its own pre-tunnel TCP proof.
  Under an armed barrier the dial is not moved; the only case is an automatic hy2 session that reached Connected
  reconnecting in place, and only while the flag is on, no backoff runs, and the catalog's hy2 block is exactly the
  node the barrier already permits (same IPv4, port, protocol, pin). If the flag was revoked or the block changed,
  the reconnect rebuilds the selected Reality block with the barrier kept (the existing VLESS/HY2 rebuild path):
  the fail-closed choice, since keeping hy2 after revocation would be an automatic hy2 dial without a grant. A hot
  switch away from an automatic hy2 session is judged by the exact node the runtime dials (recorded at admission,
  before Connected is published), and its rollback and socket cleanup use that dial name; the base name is only the
  UI selection.
  The sticky healer no longer hops onto a hy2 block by itself (it did after one failure, without any flag:
  [WIN-HEAL-UNGATED-HY2-HOP](../findings.d/WIN-HEAL-UNGATED-HY2-HOP.md)); a hand-picked hy2 row can still fall back
  to TCP as before.
  Same as macOS (#1499): N = 3, 24 h memory not extended by reuse, a first 30 min block after a failed automatic
  hy2 attempt, flag not cached across launches, cleared on flag false / block gone / account change / manual pick.
  Different on purpose: Windows also counts its pre-tunnel TCP proof failure, `tls handshake eof` and
  `TONO_NODE_OR_CORE_UNREACHABLE` (the Windows connect path reports a dead Reality path under those, and they are
  what the Windows dashboard already treats as "try the backup channel"); the block doubles per further failure up to
  6 h instead of staying 30 min (fewer automatic retries of a hy2 path that keeps failing); the twin must also have
  the same IPv4 (stricter same-node check); and the Windows healer is held on the selected node while the switch
  holds (macOS has no live healer hop).
  Rejected: trusting the cached flag offline (moves without a fresh grant); counting every failure class (a local
  Service or DNS failure says nothing about Reality); extending the 24 h on each reconnect (Reality would never be
  retried); persisting the hy2 name as the selection.
- Why stricter: nothing moves without a live per-account grant; never another node or identity; WFP permits are the
  ones a manual hy2 pick already uses (that node's IPv4, port, UDP) and only for the dialed block; no Windows Service
  protocol change; at most one automatic hy2 attempt per node per backoff window.
- Applied in: PR `amp/a17-hy2-auto-switch-windows` (`apps/windows/crates/tono-core/src/hy2_switch.rs`,
  `apps/windows/app/src-tauri/src/tono/connection/heal.rs`). macOS half: PR #1499 (its own decision file).
