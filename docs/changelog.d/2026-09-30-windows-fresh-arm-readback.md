## 2026-09-30 · Bind Windows verification readback to the fresh Connect arm
- 归属：SHIP_PLAN §2 item 10; tonight's Windows regression review.
- 来源：baseline `f7d82d30`; branch `hunt/sol-r3regw-fresh-arm-proof`; source PR, not merged when authored.
- 缺陷修复：a single lost MarkVerified request during reconnect could be acknowledged by inherited verification, leaving #1021's seven-minute cleanup deadline active against a healthy session. Current status now withholds verification until this arm's mark commits; finding `R3REGW-FRESH-ARM-READBACK` (P1).
- 新增/优化：none; durable crash-recovery evidence, explicit strict behavior and selective AI release retain their existing semantics.
- 工程与测试：one actual-Service regression checks retained durable proof, uncommitted fresh readback and idempotent mark completion.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2; baseline narrow regression failed at inherited acknowledgement; final WFP tests recorded in the PR. Native Windows App/Service and installed WFP/DNS checks cannot run here.
- 候选/发布：仅源码，无新候选; no deploy or publication.
- 剩余限制：Linux filter facade is not installed-device evidence; native CI and needs-hardware acceptance remain required.
