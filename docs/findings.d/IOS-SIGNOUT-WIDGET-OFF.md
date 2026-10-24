| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-SIGNOUT-WIDGET-OFF | iOS 连接中退出登录，停止中的隧道报告晚于「未登录」便签写入，小组件与控制中心显示「未连接 · 连接」而非「未登录」 | in-PR | 待开（fix/t1-ios-state） | 中·源码推导；TonoKit 场景回归在旧行为上失败 | 共享状态读取让 off/未登录便签不被更早开启的会话的负面报告覆盖，signOut 末尾强制发布；真机小组件未验证 |

证据（修复前，main 322f48c6f）：`apps/ios/App/Model/AppModel.swift:283-328`（第二次 recompute 被 `:974-980` 的 guard 早退，不重写便签）、
`apps/ios/TonoKit/Sources/TonoKit/SharedStatus.swift:190-191`（更晚的负面隧道报告胜出）。来源：Antigravity P2。
回归：`StateIntentTests` 的「sign-out while connected」行。
