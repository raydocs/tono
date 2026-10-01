## 2026-09-30 · Windows committed exit drains session credentials
- 归属：SHIP_PLAN §2 item 10; Windows sign-in durability and Quit reliability.
- 来源：origin/main `f8e32e00` → branch `hunt/sol-winapp-quit-vault-flush`, [#980](https://github.com/raydocs/tono/pull/980); source PR, not merged at authoring.
- 缺陷修复：WIN-QUIT-ROTATED-TOKEN-DURABILITY (P1): a rotated token whose first vault write failed could survive only in memory when Quit cancelled the next sync; committed exit now asks the existing ordered writer to retry and acknowledge it before exit.
- 新增/优化：无; audit and credential drains run together within the existing two-second allowance, including bounded state acquisition. Network release, AI blocking, strict mode and vault ownership rules are unchanged.
- 工程与测试：one regression uses the production session writer and a vault whose first write fails; the committed-exit helper must persist the rotated token before a later launch.
- 验证：Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2`, portable extraction of the unchanged production writer, real tono-core credential trait/store and checked-in helper/test: baseline failed (durable token remained previous-session); fixed test passed (1 passed). `git diff --check` passed. Full Tauri/Windows-only checks not runnable in this VM; hosted Windows CI required.
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：persistent vault errors still cannot be made durable; exit is bounded and logs missing acknowledgement. Late rotations after the barrier and real Credential Manager/device testing are outside this fix.
