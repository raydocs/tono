## 2026-10-01 · Preserve custom AI resolver configuration
- Ownership: SHIP_PLAN §2 item 10; macOS helper selective recovery.
- Source: baseline `9947450e`; branch `hunt/sol-r4fma-resolver-ownership`, not merged at authoring.
- Bug fix: #1062. Ordinary arm/Disconnect preserves resolver files Tono never installed. Automatic selective recovery records custom bytes and metadata before installing the same AI sinkhole; repeated application keeps originals and cleanup restores them atomically. Later administrator replacements survive cleanup.
- Added/optimized: no suffix, route, PF or strict-mode changes. Existing resolver-directory metadata is preserved.
- Engineering/test: one root lifecycle regression round-trips a product-owned 0660 resolver through repeated apply/remove, verifies owner/group/mode, absence cleanup, pre-install cleanup and newer replacement preservation using only temporary directories.
- Verification: Linux `git diff --check`, records parser and exact helper contract; native Swift execution unavailable and required in macOS CI.
- Candidate/publication: source only; no new package or publication.
- Remaining limits: `needs-hardware`; legacy sinkholes without receipts remain unattributed, already-lost originals cannot be reconstructed, and files over 1 MiB/native storage failures are refused best-effort.
