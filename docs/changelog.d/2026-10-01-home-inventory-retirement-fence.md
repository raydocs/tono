## 2026-10-01 · Fence standalone home retirement against assignment
- Ownership: SHIP_PLAN §2 item 10; residential catalog availability.
- Source: baseline `9369e620`; branch `hunt/sol-r4fcp-home-inventory-retire`; fixes #1198. Source changes only.
- Defect fix: four home-inventory retirement paths could overwrite a concurrent binding. Retirement UPDATEs now require no current bindings; replacement skips cleanup if the old home gained another owner.
- Added/optimized: v1 commercial and lifecycle metadata commit in the same guarded write so refusal preserves the whole asset. Intentional disabled pauses retain existing behavior.
- Engineering/tests: one real D1 regression per path, each failing before the fix; refusal side effects and successful replacement are asserted.
- Verification: Linux, Node24; npm ci, typecheck, focused D1 checks (83 tests) and full suite (46 files /995 tests) passed. Final strengthened replacement assertion passed in a focused rerun. Independent review, diff, ops budgets and contract purity passed.
- Candidate/publication: source only; no deploy, publication or new candidate.
- Remaining limits: overlapping admin requests remain independently audited; installed network acceptance runs on real hardware at the end.
