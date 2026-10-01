## 2026-09-30 · Windows sign-in retains a durable installation identity
- 归属：SHIP_PLAN §2 item 10; Windows account/session reliability.
- 来源：baseline `259daecb`; branch `hunt/sol-r4wapp-stable-installation-id`; PR pending, not merged at authoring.
- 缺陷修复：an ID vault read/write failure previously admitted a process-new device identity, potentially evicting another device; sign-in now requires a normalized read or acknowledged first-run write and leaves failed loads retryable.
- 新增/优化：no new capability; stable-ID re-authentication still works when the refresh token is unreadable.
- 工程与测试：three narrow regressions cover ID-read retry, first-run write acknowledgement/failure, and unreadable-refresh replacement with a stable ID.
- 验证：Linux exact production-function extraction with external boundaries stubbed: the read-error test failed before (`an unreadable identity must remain retryable`); all three tests pass after. `git diff --check` and Rust parser checks pass. Native Windows/Tauri and Credential Manager tests not run here; hosted CI required.
- 候选/发布：source only; no new candidate, deployment or publication.
- 剩余限制：no real Windows vault fault injection performed; existing vault writer and AI/network disposition are unchanged.
