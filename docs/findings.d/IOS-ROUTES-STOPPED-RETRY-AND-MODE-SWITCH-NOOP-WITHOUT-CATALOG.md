| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-ROUTES-STOPPED-RETRY-AND-MODE-SWITCH-NOOP-WITHOUT-CATALOG | iOS 启动时隧道已在运行而线路列表未载入（catalog 为 nil），「路由已停止」后的重试与切换模式静默无效，且把请求当成已生效 | in-PR | T2 `fix/t2-ios-account`（`RouteApply.withCatalog`） | 高·源码推导 | 由 T2 修复（2026-10-24 协调：T2 独占 `AppModel.change` 的 catalog nil 分支）；T1 曾实现并撤回（见下）。真机未验证 |

证据（修复前，main 322f48c6f）：`apps/ios/App/Model/AppModel.swift:506-524`（`catalog == nil` 时报 `.saved(requested)`，`finish` 把请求设为在用）、`:334-337`（重试只走 `change(retry:)`）。来源：Antigravity 最终报告 #15（编排者已抽查）。
回归：`RouteApplyTests.testAChangeWithoutACatalogOnARunningTunnelIsNotAppliedNotSaved`。

2026-10-24（T1）：T1 在 #1741 中曾实现同一修复（先刷新，否则采用隧道 inputs 文件里本账户的 catalog，否则报 NO_CATALOG），
RED 为 CI run 40082246750（`RouteApplyTests.swift:126/127`）。与 T2 分支重叠，按协调已用 revert 撤出 #1741，交给 T2。给 T2 的两点：
1. 本地失败不能以带 ticket、回复为 nil 的形式进 `ConfirmationTracker.settle`：`received(nil)` 会清掉已确认的图，正在运行的隧道会变成「未确认」
   （T1 回归在旧代码 efcf5fc00 本地失败：确认变 `unknown`）。T2 的 `!report.wrote ||` 跳过了 settle，满足这一点；
   但 `tracker.ask()` 仍在 catalog 为空时被调用，可以考虑在没有 catalog 时不提问。
2. 刷新失败时，隧道 inputs 文件里本账户的 catalog 可以作为重建来源（退出登录会删除该文件），比直接报失败少一次无效重试。
