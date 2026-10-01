## 2026-09-30 · Windows selective-release retries retain the AI hold
- Ownership: SHIP_PLAN §2 item 10; Windows App Service client.
- Source: origin/main `d8c6a15a` → branch `hunt/sol-trust-selective-release-retry`; pending PR, not merged at writing.
- Defect fix: an automatic release refused transiently could retry as ordinary release and omit/remove the AI hold. Operational retries now retain the selective flavor. Only an explicit legacy JSON-payload refusal falls back to null, preserving older-Service network recovery.
- Added/optimized: none. Strict admission, full network release ordering and explicit Restore/Disconnect remain unchanged.
- Engineering/tests: one regression for transient refusal and one compatibility regression for legacy Service deserialization refusal; no test removal or gate change.
- Verification: Linux Rust 1.98.1, CARGO_BUILD_JOBS=2; exact production helper/error classifier and checked-in tests extracted to a portable harness, logging sink substituted. Before: 1 passed, 1 failed at missing AI hold. After: 2 passed, 0 failed. `git diff --check` passed. Full native Windows/Tauri compilation and actual DNS/WFP/NRPT behavior cannot run in this VM; hosted CI and final hardware batch required.
- Candidate/publication: source only, no new candidate, deployment or publication.
- Remaining limits: P2 (automatic recovery trigger plus transient release error). Older Services cannot install the optional AI hold; existing selective-layer best-effort/system-resolver limitations remain. See WIN-SELECTIVE-RELEASE-RETRY.
