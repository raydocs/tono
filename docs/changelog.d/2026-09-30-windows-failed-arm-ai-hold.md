## 2026-09-30 · Failed Windows arms preserve the AI hold
- 归属：SHIP_PLAN §2 item 10；Windows Service WFP installation.
- 来源：origin/main `8ff1103e` → `c2753efe`, `hunt/sol-r3ks-arm-ai-hold`, [#976](https://github.com/raydocs/tono/pull/976); awaiting CI/merge.
- 缺陷修复：installation removed the previous recovery AI hold before the replacement WFP transaction, including when that transaction failed. Removal now happens only after a successful install. Finding: WIN-FAILED-ARM-AI-HOLD (P2).
- 新增/优化：无；general release and explicit strict-mode behavior are preserved.
- 工程与测试：one narrow failed-arm regression; the test backend and serial isolation match #974.
- 验证：Linux Rust 1.98.1; regression failed before at the missing AI hold. `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests::`: `87 passed; 0 failed`; `git diff --check` passed. Existing warnings remain.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：Windows-only FFI and installed firewall/DNS behavior require hosted Windows CI and needs-hardware testing. The existing narrow-layer limitations remain.
