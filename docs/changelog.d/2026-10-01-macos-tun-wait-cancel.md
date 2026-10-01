## 2026-10-01 · macOS 隧道等待在最后一次睡眠后仍看取消
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 连接时等待 utun199。
- 来源：`origin/main` `5ba113d2` 上的 `hunt/grok-macrt-tun-wait-cancel`；PR 待开；未合 main。Fixes #864。
- 缺陷修复：最后一次轮询睡眠被取消时不再把已经出现的 utun199 当成就绪。取消的连接不会因此先武装 PF。
- 新增/优化：无。
- 工程与测试：`OwnedTunnelWaitTests.testCancelDuringTheLastSleepDoesNotReportTheInterface`。接口和睡眠是测试缝，不调用内核。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：接口在取消之前就已经存在时，函数仍返回 true，随后由调用方的 `checkCancellation` 收尾。
