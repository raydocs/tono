## 2026-09-30 · Retire automatic macOS retry when the user restores internet
- Ownership: SHIP_PLAN §2 item 10; regression review of merged #720.
- Source: main `61d8c985` → branch `hunt/sol-r3regm-unarmed-owner`; pending PR, not yet merged.
- Bug fix: an unarmed retry no longer survives explicit Restore or uses a late TCP/status answer to reconnect and re-arm without a new user intent. Finding MAC-UNARMED-RETRY-RELEASE-OWNER, P1.
- Added/optimized: none. No PF/DNS/helper contract, AI-blocking, strict-mode or release disposition change.
- Engineering/tests: two narrow actual-path XCTest regressions park TCP proof and failure status at their asynchronous boundaries; simulated helper release completes before the late reply.
- Verification: Linux `git diff --check` and findings parser passed; two independent read-only reviews checked ownership, deadlock and fixture behavior. Swift/XCTest unavailable; existing macOS CI must compile/run. No executed native failing-then-passing result claimed.
- Candidate/publication: source only; no candidate, deployment, or publication.
- Remaining limits: needs-hardware for installed retry/Restore behavior. TCP proof stays read-only and is not awaited by teardown. Existing legacy AI-release contract concern is outside this owner fix.
