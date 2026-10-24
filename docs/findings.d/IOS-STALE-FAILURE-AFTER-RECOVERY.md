| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-STALE-FAILURE-AFTER-RECOVERY | iOS 系统停止（core 退出、jetsam）后 On Demand 恢复成功，旧失败未清，之后用户主动关闭时显示「连接已断开 · 重试」 | in-PR | 待开（fix/t1-ios-state） | 中·源码推导；TonoKit 场景回归在旧行为上失败 | 修复为隧道再次 connected 时清除旧失败（`TunnelIntentLedger.tunnel(.connected…)`）；真机断网/jetsam 恢复未验证 |

证据（修复前，main 322f48c6f）：`apps/ios/App/Model/AppModel.swift:818-819`（`stoppedBySystem` 记 failure）、
`:802-803`（connected 只清 userStarting）、`:375-383`（disconnect 不清 failure）；
`apps/ios/TonoKit/Sources/TonoKit/ConnectionState.swift:276-280`（断开时有 failure 即 `.failed`）。来源：REVIEW.claude.md。
回归：`StateIntentTests` 的「jetsam then On Demand recovery, then the user switches off」行。
