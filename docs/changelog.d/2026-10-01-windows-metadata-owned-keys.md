## 2026-10-01 · Windows undeclared metadata uses safe string fallbacks
- Ownership: SHIP_PLAN §2 item 10; Windows lifecycle reliability, rendering crash fixes only.
- Source: baseline `6758431f`; branch `hunt/sol-r4ts-metadata-owned-keys`; PR [#1129](https://github.com/raydocs/tono/pull/1129), not merged at authoring.
- Defect fixes: valid prototype-key catalog names crashed node metadata (R4TS-NODE-META-PROTOTYPE, P2); after #951, an extensionless prototype-key process still crashed Activity translation (P3 continuation of WIN-ACTIVITY-PROCESS-PROTOTYPE). Require declared own mapping keys and retain existing unknown-string fallbacks.
- Added/optimized: none; no visual layout or network/protection change.
- Engineering/tests: one narrow public-metadata regression and one actual Activity-page regression. Both fail before on string/translator exceptions; after: 34 tests passed in the two focused files; `pnpm typecheck` passed with unchecked-index errors 79/baseline 79.
- Verification: Linux Node 24 / pnpm 11.26.0; native Windows/Tauri execution and ownership of an extensionless process not runnable here.
- Candidate/publication: source only; no new candidate or publication.
- Limits: unusual administrator node naming is required for the node bug; extensionless process scenario is narrow. Neither is a machine/network crash claim.
