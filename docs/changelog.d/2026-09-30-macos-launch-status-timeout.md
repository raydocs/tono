## 2026-09-30 · macOS 启动时更新状态超时与连不上同等处理
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 启动时的 helper 状态查询。
- 来源：`origin/main` `ff81118a` 上的 `hunt/grok-macrt-launch-status-timeout`；PR #840；未合 main。
- 缺陷修复：`/update/status` 读超时或套接字写失败与 `connectFailed` 一样进入已有的启动修复：后台项关闭时只提示且不修复，未加载时走管理员修复后再问一次。禁止和坏正文仍抛给调用方。
- 新增/优化：无。
- 工程与测试：`HelperUnprotectedNoticeTests.testUpdateStatusTimeoutGetsTheSameLaunchRepairAsARefusedSocket`。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：不缩短或加长 `/update/status` 的 6 秒超时。已加载且一直超时的 helper 仍先等 2 秒再走修复。
