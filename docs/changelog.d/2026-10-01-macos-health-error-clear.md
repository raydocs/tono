## 2026-10-01 · macOS 健康成功只清掉自己的错误
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 已连接会话的健康检查。
- 来源：`origin/main` `f80951fb` 上的 `hunt/grok-macrt-health-error`；PR #885；未合 main。Fixes #863。
- 缺陷修复：健康且没有 advisory 时，只清掉「正在恢复受保护连接」和本监控留下的分类失败文案。目录被拒等其他提示留在界面上。
- 新增/优化：无。
- 工程与测试：`HealthTickErrorTests.testHealthyTickClearsOnlyTheMonitorsOwnMessage`。流量探测用测试缝，不打 TLS。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：分类失败的 `userMessage` 若与另一条提示逐字相同，健康拍仍会清掉那条。当前文案不相交。
