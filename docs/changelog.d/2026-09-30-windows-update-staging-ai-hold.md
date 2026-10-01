## 2026-09-30 · Windows failed update staging keeps automatic AI protection
- 归属：SHIP_PLAN §2 item 10；Windows App/Service protected-update recovery.
- 来源：`origin/main` 00c6def8；分支 `hunt/sol-r3acct-update-stage-ai-hold`；PR pending, not yet merged.
- 缺陷修复：reserved private package copy/extraction failures now reach existing automatic narrow cleanup; automatic App recovery cannot use explicit update Disconnect and remove the AI hold. Narrow release refuses strict intent under the WFP writer; explicit Restore stays available. Finding WIN-FAILED-PREPARE-AI-HOLD.
- 新增/优化：无；receipt obligations and failure evidence remain; no wire/schema/protocol change.
- 工程与测试：one regression each for pre-Core-stop staging error dispatch, App release intent, and strict WFP automatic versus explicit release. Existing Prepare predicate regression is updated for all reserved failures.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2; exact-function dispatch harness 0 passed/2 failed before and 2 passed/0 failed after. Actual WFP strict regression failed before; fixed Service WFP suite 108 passed/0 failed. `git diff --check` passed. Windows-only coordinator/App compilation, native staging tests and installed update/DNS/WFP not run locally.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：needs-hardware; evidence-open or durable disconnect-record failure can still refuse cleanup; existing narrow-layer coverage limits remain.
