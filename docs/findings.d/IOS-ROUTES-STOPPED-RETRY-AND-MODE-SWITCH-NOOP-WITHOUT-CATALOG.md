| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-ROUTES-STOPPED-RETRY-AND-MODE-SWITCH-NOOP-WITHOUT-CATALOG | 运行隧道缺 catalog 时重试/切模式静默假报已保存 | in-PR | #1745 | 高·实测 | 单测故障复现；待真机与服务端联验，尚未合 main |

证据（apps/ios 下）：RouteApply.swift:113-122；AppModel.swift:510-542。MissingCatalogTests 的运行中刷新与刷新失败报告断言 在 `ada2fe694` 的 [RED CI](https://github.com/raydocs/tono/actions/runs/40083275707/job/120841004218) 真实失败；修复源码 `50b332d61`，[GREEN 单测 run 40083408024](https://github.com/raydocs/tono/actions/runs/40083408024/job/120841450340)：143 tests / 0 failures（后续非 T2 的路由 harness 失败，完整 workflow 非绿）。未放宽 TLS/账户隔离/权限。详细边界见 [T2 更新记录](../changelog.d/2026-10-24-t2-ios-account.md)。
