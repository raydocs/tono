## 2026-10-01 · Reject special files in app silent-upgrade validation
- Ownership: SHIP_PLAN §2 item 10; macOS helper-upgrade client.
- Source: `fafa1bc0` → branch `hunt/sol-r4fma-upgrade-fifo`; source PR pending, not yet merged.
- Bug fix: an in-bundle writerless FIFO blocked validation before signature checking → nonblocking descriptor open plus regular-file proof refuses it; issue #1162 / R4FMA-UPGRADE-APP-FIFO.
- New/optimized behavior: none. Existing bundle confinement, signature checks and recovery disposition remain.
- Engineering/tests: one bounded XCTest in HelperUpgradePathConfinementTests; cleanup unblocks the old reader without changing validator actor isolation.
- Verification: Linux extracted POSIX baseline flags blocked beyond350ms, fixed flags returned promptly and fstat rejected FIFO; git diff --check and records parsers passed. Swift/XCTest/macOS build unavailable here; hosted CI required. No local native passing claim.
- Candidate/publication: source only; no candidate, deployment or publication.
- Remaining limitations: malformed/tampered local bundle prerequisite (P2); legacy abandoned-upgrade AI disposition remains issue #1071. No live-network behavior changes.
