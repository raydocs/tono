## 2026-09-30 · Restore macOS pins-refresh DIRECT permits before advisory readiness
- Ownership: SHIP_PLAN §2 item 10; macOS regression review of tonight's merged fixes.
- Source: main `4ef4bf74` → branch `hunt/sol-r3regm-pins-readiness`; pending PR, not yet merged.
- Bug fix: successful `/core/sync` followed by a readiness/status error no longer skips exact PF convergence and leaves ordinary DIRECT traffic blocked. Finding MAC-PINS-SYNC-READINESS, P1; regression introduced by #950.
- Added/optimized: none. No new release, helper protocol, AI route, or strict-mode policy.
- Engineering/tests: one XCTest drives the actual config-reload transaction, real config writer, successful replacement/tunnel seams and failing readiness; asserts the second arm, installed policy and retained session.
- Verification: Linux `git diff --check` and findings-fragment parser passed. Two independent read-only reviews checked production ordering and fixture isolation. Swift/XCTest unavailable locally; existing macOS CI must compile and execute it. No native failing-then-passing run claimed.
- Candidate/publication: source only; no candidate, deployment, or publication.
- Remaining limits: needs-hardware for installed pins-refresh/PF behavior. Failed helper sync, failed tunnel recreation and failed PF convergence retain existing recovery; this fixes the successful-sync/readiness-error boundary only.
