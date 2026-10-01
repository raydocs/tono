## 2026-10-01 · Recover inactive accounts after exit-agent ledger loss
- Ownership: SHIP_PLAN §2 item 10; control-plane/exit-agent billing recovery.
- Source: baseline `42fffd3d`; branch `hunt/sol-r4fcp-inactive-watermarks`; fixes #1069.
- Defect fix: expired accounts' retained Xray counters lost their source recovery watermark and replayed historical billing after local state loss. A separate authenticated sourceUsageWatermarks set recovers those totals without granting traffic authorization.
- Added/optimized: additive roster field; existing active-identity fields and legacy fallback retained. Fresh maps are validated; saved maps are preserved but never used as fresh billing observations during outages.
- Engineering/tests: explicit fifth parser/fetch return value; existing mock tuple shape updated without removing assertions. One Worker/D1 regression and one actual-fetch agent lifecycle regression fail before/pass after; three narrow new-input validation tests pass.
- Verification: Linux Node24, disposable Workers/D1; focused Worker tests2 passed; pytest115 passed and7 subtests passed; `npm ci`, `npm run typecheck`, full `npm test`46 files/984 tests and coverage floors passed. Independent read-only review, parser/cache checks and diff check passed.
- Candidate/publication: source only; no new candidate, deploy, node update or publication.
- Remaining limits: recovery of inactive historical counters requires both new server and new agent. Missing local state cannot reconstruct unobserved counter generations; installed Xray/hy2 acceptance not performed.
