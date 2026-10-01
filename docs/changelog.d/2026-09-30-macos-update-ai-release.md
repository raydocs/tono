## 2026-09-30 · macOS 更新恢复失败保留 AI 层
- 归属：SHIP_PLAN §2 item 10；DNS / PF 恢复组合复核。
- 来源：origin/main `a28b99bd` → 分支 `hunt/sol-r4dns-update-ai-release`；待 PR / 合入。
- 缺陷修复：pending-update gate 原丢失自动失败标志、调用显式断开，现经 update 事务释放普通网络并保留 AI 层。保持原认证、DNS / Core 清理及更新凭据。
- 新增/优化：新增空 body 的已认证 `/update/release` 意图；显式 Disconnect 和严格模式分支不变，无兼容退回显式释放。
- 工程与测试：App 窄回归覆盖 launch-owned pending receipt；helper 窄回归覆盖 adopted successor、durable intent、AI effect 与保留 consumed obligation。现有显式断开测试不变。
- 验证：Linux 仅执行 diff / records / CONTRACT 检查及两名只读审查；Swift、XCTest、helper self-test、原生 PF / DNS 未执行，待 macOS CI。
- 候选/发布：仅源码，无新候选、无部署或发布。
- 剩余限制：macOS 实机验收；中断释放后的 durable AI intent 问题另见 #1078。
