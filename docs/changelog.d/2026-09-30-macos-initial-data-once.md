## 2026-09-30 · macOS 启动磁盘快照只应用一次
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 启动时的本地状态加载。
- 来源：`origin/main` `50bbbbf0` 上的 `hunt/grok-macrt-initial-data-once`；PR 待开；未合 main。
- 缺陷修复：第二个主窗口的 `loadInitialData` 在第一次应用挂起时不再安装第二遍缓存目录。应用任务在第一次 await 之前认领。
- 新增/优化：无。
- 工程与测试：`InitialDataApplyTests.testSecondLoadInitialDataJoinsTheInFlightApply`。测试快照不读 `ConfigStorage.shared`。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：已经完成的应用仍把 `initialDataLoaded` 设为 true；之后的调用直接返回。
