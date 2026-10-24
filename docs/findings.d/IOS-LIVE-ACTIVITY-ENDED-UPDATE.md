| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-LIVE-ACTIVITY-ENDED-UPDATE | iOS Live Activity 失败后以 5 分钟延迟结束，期间重新连接时 `Activity.activities.first` 仍是已结束的活动，只对它调 update，不新建活动 | open | 待开 | 低·源码推导 | ActivityKit 无 TonoKit 可测缝，未写回归、未修；「过期时丢掉 detail/footnote」复核为既定设计（`WidgetUI/StatusViews.swift:163` 注释），不算缺陷 |

证据（main 322f48c6f）：`apps/ios/App/Services/LiveActivityController.swift:14,27-31,35-36`（`running` 不按 `activityState` 过滤）。
来源：Antigravity（未核实），本线程 T1 复核源码后保留为 open。
