## 2026-10-01 · Windows Disconnect preserves its intent when joining automatic release
- 归属：SHIP_PLAN §2 item 10; Windows explicit network restoration.
- 来源：origin/main afd58db1; hunt/sol-r4fws-disconnect-intent; source PR, not yet merged.
- 缺陷修复：#1109, explicit Disconnect during an automatic applying-narrow release now carries its requested AI removal into the shared operation. The already-dispatched automatic release completes, then ordered plain cleanup removes the hold before shared success/admission.
- 新增/优化：无。Automatic releases still retain AI when no explicit removal joins; strict and pending-update authority remain separate and unchanged.
- 工程与测试：one paused actual-coordinator regression; existing writer-transfer/inverse join, cancelled-waiter metadata and refusal regressions retained.
- 验证：Linux Rust 1.98.1 exact coordinator/slot/FSM boundary fixture: before 0 passed / 1 failed (“shared success cannot precede the user's remove-AI cleanup”); after 4 passed / 0 failed. Initial new test failed compilation because temporary wait futures were not pinned; corrected test pinning before behavioral runs. git diff --check / Rust syntax parsing passed; full Windows/Tauri/WFP/NRPT unavailable here.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware. Existing UI deadline can stop waiting during two slow Service sequences while the detached owner continues. Actual Service failures retain existing error/retry behavior.
