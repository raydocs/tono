## 2026-10-01 · Close the current Claude account assignment atomically
- Scope: ops plan §2; product-account lifecycle and billing inventory correctness.
- Source: origin/main `14347158`; branch `hunt/sol-r4cpc-close-current-product`, PR [#1186](https://github.com/raydocs/tono/pull/1186).
- Fix: account close selects and retires the current assigned Claude account inside its transaction. Previously a replacement committed after the pre-read escaped retirement, leaving a disabled customer's replacement marked assigned and billable.
- Added behavior: none; the existing disable, home reclamation, allowlist removal, and device/session enforcement semantics are preserved.
- Regression: a Worker/D1 close request paused before its transaction, followed by account replacement, first left the replacement assigned. It now retires the replacement and attributes the close event to it.
- Verification: Linux, Node 22.14.0; `npm run typecheck` passed; `npx vitest run test/ops-api.test.ts test/worker.test.ts` passed 253 tests, including the existing disable-failure rollback check.
- Release: source only; no package, deployment, or publication.
- Limits: two overlapping operator actions are required (P2); existing historical assignments are not rewritten.
