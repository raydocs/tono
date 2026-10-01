## 2026-10-01 · Fence home assignment against fleet retirement
- Ownership: SHIP_PLAN §2 item 10; control-plane residential routing availability.
- Source: baseline `28d9c26e`; branch `hunt/sol-r4fcp-home-bind-retire`; fixes #1102. Source changes only.
- Defect fix: overlapping home assignment and fleet retirement could both succeed with a binding to a removed node. Atomic write predicates make the losing operation refuse; a refused replacement retains its prior home.
- Added/optimized: none. Pre-catalog provisioning and proper relist remain supported; no fallback to cloud/direct or protection changes.
- Engineering/tests: one real D1 regression for each commit order/write path; all three failed before the fix.
- Verification: Linux, Node24; `npm ci`, `npm run typecheck`, full `npm test` (46 files / 984 tests) passed; the final added batch-side-effect assertions passed in their focused rerun. Independent read-only review passed. Diff, ops budgets and contract purity passed.
- Candidate/publication: source only, no new candidate, deploy or publication.
- Remaining limits: native installed exit acceptance unavailable; ops actions remain independently audited and revision bumps retain their existing caller order.
