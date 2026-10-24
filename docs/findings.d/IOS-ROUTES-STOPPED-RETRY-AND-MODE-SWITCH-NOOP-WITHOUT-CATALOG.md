| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-ROUTES-STOPPED-RETRY-AND-MODE-SWITCH-NOOP-WITHOUT-CATALOG | iOS 启动时隧道已在运行而线路列表未载入（catalog 为 nil），「路由已停止」后的重试与切换模式静默无效，且把请求当成已生效 | in-PR | 待开（fix/t1-ios-state） | 高·源码推导；TonoKit 回归在旧行为上失败 | 现先刷新线路列表，失败则采用隧道 inputs 文件里本账户的 catalog（退出登录会删除该文件）；仍没有时报 NO_CATALOG（不写文件、不改在用路由），首页与设置页显示「暂时取不到线路列表」；App 侧回退路径只做源码与 CI 编译核对，真机未验证 |

证据（修复前，main 322f48c6f）：`apps/ios/App/Model/AppModel.swift:506-524`（`catalog == nil` 时报 `.saved(requested)`，`finish` 把请求设为在用）、`:334-337`（重试只走 `change(retry:)`）。来源：Antigravity 最终报告 #15（编排者已抽查）。
回归：`RouteApplyTests.testAChangeWithoutACatalogOnARunningTunnelIsNotAppliedNotSaved`。
