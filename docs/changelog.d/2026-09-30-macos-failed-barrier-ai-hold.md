## 2026-09-30 · Preserve the AI hold after a failed helper barrier
- Ownership: SHIP_PLAN §2 item 10; macOS helper M1/M2.
- Source: baseline `87a0754c`; branch `hunt/sol-r3helper-failed-barrier-ai-hold`; source-only PR, not yet merged.
- Bug fix: failed PF commits and the merged #773 orphaned-bootstrap crash recovery released general protection without restoring the secondary AI hold. Successful automatic release now applies that hold after the release; explicit Restore/disarm semantics are unchanged.
- New/optimized: none.
- Engineering/tests: three narrow helper self-tests cover failed-barrier release-before-apply, failed-release suppression and orphaned-bootstrap release ordering; helper protocol bumped and contract hash regenerated.
- Verification: Linux source/diff/contract checks only. Swift compilation, helper self-tests and native sleep/PF/DNS behavior cannot run here; macOS CI/hardware remain required.
- Candidate/publish: source only, no new package and no deployment/publication.
- Limits: the secondary layer is best-effort; subsequent App-level explicit-disarm semantics are outside this correction.
