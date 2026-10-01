## 2026-10-01 · Retry snapshotless DNS activation
- Ownership: SHIP_PLAN §2 item 10; macOS helper recovery.
- Source: baseline `f199567d`; branch `hunt/sol-r4fma-snapshotless-dns-apply`, not merged at authoring.
- Bug fix: #1063. After snapshotless Commit succeeds and Apply fails, a later restore must request activation of the persisted configuration or report failure, even when the configured resolver list is already empty.
- Added/optimized: no new DNS server, AI policy, PF, or strict-mode change. Apply-only does not rewrite foreign custom DNS or Commit unrelated settings.
- Engineering/test: one injected persisted-versus-active regression covers failed writer Apply, failed activation retry, then successful activation while foreign DNS stays unchanged.
- Verification: Linux `git diff --check`, records parser, exact helper CONTRACT; native Swift execution unavailable, macOS CI required.
- Candidate/publication: source only, no new package/publication.
- Remaining limits: `needs-hardware`; Apply is asynchronous; existing active-state update proof remains authoritative and automatic recovery after a quarantined snapshot remains a separate lifecycle limitation.
