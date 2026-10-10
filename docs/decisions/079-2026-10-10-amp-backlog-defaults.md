## 2026-10-10 · Amp backlog: the recommended option is taken for every open question, and every item is dispatched
- Status: owner ("按你推荐的来 然后不派给 amp 的也派了吧 派了一起做", 2026-10-10)
- Chosen: for [docs/ops/amp-backlog-2026-10-10.md](../ops/amp-backlog-2026-10-10.md) §7 the recommended option of each question:
  D1-C (hy2 auto-switch on for internal accounts first, all accounts after two weeks), D2-A (Amp may change hy2 config on
  production nodes after a backup, never the xray block on 443), D3-A (macOS connected-state private-network permit closed
  like Windows, behind an "allow LAN devices" setting that defaults off), D4-A (H1-F5 recorded as a known risk and the
  bootstrap window shortened to seconds), D6-A (pure file splits, one file per PR), D7-A (nodes self-register with a
  per-node token), D8-A (build provenance generated and audited, not yet verified by clients), D9-A (screenshot tests move
  to a post-merge nightly), D10-A (merged remote branches deleted automatically), D11-A (Amp PRs merge under AGENTS.md;
  high-risk ones need a review receipt), D14-A (pre-login path probe with handshake only, no identity), D15-A (lowering
  the device cap evicts the oldest devices at once). D16 stays with the owner (a Cloudflare token for the backup job).
  The items §6 had kept from an unattended session are dispatched too: the PF/WFP semantic changes go with a mandatory
  independent review receipt, real-hardware acceptance items are done up to the code and test boundary with the hardware
  evidence left to the owner, and sea UI adjustments are implemented and handed over as screenshots for the owner's eye.
  Rejected: waiting for per-question answers; keeping the PF/WFP and UI items unassigned.
- Why stricter: every chosen option is the one that does not widen exposure: LAN access closed by default, auto-switch
  limited to internal accounts first, provenance added without changing what clients accept, device-cap eviction
  immediate, probes without identity. Nothing loosens fail-closed PF/WFP; the PF items still need a review receipt.
- Applied in: PR `docs/amp-backlog-decided-20261010` (backlog §6/§7 rewritten; §0 gains the Amp kickoff prompt).
