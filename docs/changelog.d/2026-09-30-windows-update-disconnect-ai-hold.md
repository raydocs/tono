## 2026-09-30 · Preserve AI hold through Windows pending-update cleanup
- 归属：SHIP_PLAN §2 item 10; tonight's Windows regression review.
- 来源：baseline `00c6def8`; branch `hunt/sol-r3regw-update-release-ai`; source PR, not merged when authored.
- 缺陷修复：early Prepare staging failure left a pending attempt; automatic App cleanup requested AI blocking but update Disconnect discarded it. An additive automatic update operation retains that disposition through the same authenticated cleanup and evidence path; finding `R3REGW-UPDATE-DISCONNECT-AI-HOLD` (P1).
- 新增/优化：none; explicit Restore/Disconnect wire behavior retained; strict automatic cleanup refuses before DNS/Core mutations; older Service refuses unknown operation.
- 工程与测试：client release deadline and Service operation projection include the new operation; narrow actual-wire/WFP disposition and strict-preservation regressions.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2; baseline disposition 0 passed, 1 failed at missing AI hold. Final WFP suite and operation tests recorded in PR; Windows-only App/update handler compile and installed behavior require CI/hardware.
- 候选/发布：仅源码，无新候选; no deploy or publication.
- 剩余限制：Linux filter facade is not native update staging or real-device evidence; existing selective DNS/cache limits remain.
