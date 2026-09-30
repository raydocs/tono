## 2026-09-30 · macOS 同名住宅节点轮换后重载当前会话
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1；macOS 托管目录与住宅助手路由。
- 来源：main `026e747c` → 分支 `codex2/mac-home-proxy-reload`；PR 待开；未合 main。
- 缺陷修复：连接中所选云节点不变、住宅节点同名轮换时，路由摘要只含住宅节点名，原会跳过重载并沿用旧地址/凭据/Reality 密钥。现保存更新前的住宅路由名，用现有名称匹配规则查找两版住宅节点，按与所选节点相同的拨号身份比较触发重载。见 `MAC-HOME-PROXY-ROTATION-STALE`。
- 新增/优化：无；没有 `homeProxy` 时保持原重载判断，沿用现有流式响应延迟与运行时重载路径。
- 工程与测试：在现有 `CatalogLiveSessionTests.swift` 新增一个 XCTest：所选节点不变、同名住宅节点 UUID 轮换、路由摘要不变时必须重载；更新全部既有 `shouldReload` 调用参数。
- 验证：Linux 工作树基线 `026e747c` 加本次未提交差异；`git diff --check` 通过，Swift 差异逐行核对参数标签、类型与可选值。此处无 Swift/Xcode、无 Windows，XCTest/Windows 测试未运行；托管 macOS CI 的 `TonoTests` 结果待补，住宅轮换与 PF 实机验证未执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：回归只覆盖重载决策，不证明实际重载、PF 端点切换或失败放行；实机与托管 CI 待验证。另见既有 `AppState+Proxy.swift` 重载失败分支：保留 PF 并安排重连，普通失败不保证放行，本次未修。
