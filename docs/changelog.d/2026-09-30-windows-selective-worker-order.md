## 2026-09-30 · Windows selective AI hold serializes late native work
- 归属：SHIP_PLAN §2 item 10；Windows Service secondary AI hold.
- 来源：origin/main `0484176a` → `d69a7f62`, `hunt/sol-r3ks-selective-worker-order`; PR pending, not merged.
- 缺陷修复：a timed-out native delete could finish after replacement and erase the requested hold; a delayed add could finish after Restore and reapply it. One coalescing worker retains native ownership and converges to the latest request. Finding: WIN-SELECTIVE-LATE-WORKER.
- 新增/优化：无；same fixed firewall names/prefixes and NRPT suffixes; general WFP release still precedes this layer; strict admission unchanged. Async removal/apply budgets remain 3/6 seconds.
- 工程与测试：one paused-native regression per ordering behavior; each latch releases on assertion failure. No gate/test removal.
- 验证：Linux Rust 1.98.1; both regressions failed before. `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::selective_layer::tests::`: 2 passed, 0 failed; WFP module filter: 87 passed, 0 failed. `git diff --check` and Rust 2024 formatting check for the touched file passed. Independent read-only review found no blocking issue. Existing compiler warnings remain.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：native Windows timing/WFP/NRPT needs CI/hardware; process-local ordering cannot fence an orphan netsh child after process death. Native command failures remain best-effort. Unwind handling does not change production panic=abort.
