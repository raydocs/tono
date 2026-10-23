| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-DASHBOARD-RETRY-STATUS-SKEW | 自动重连成功尾段的 macOS Dashboard 徽章/指标可先报 AI 已保护，详情/菜单仍等待重试 | open | [#1724](https://github.com/raydocs/tono/pull/1724) R2 残余 | 中·推导（P2/minor） | 源码时序可达，未跑渲染交错；未证明保护已释放或泄漏；本轮不改 FSM/PF/helper |

独立 Sol/xhigh R2 覆盖 `f32fcf93b3692e34005e9e16a2054158231922e9`，原 R1 三项均已修正。
新增发现：`DashboardView.swift:456–464,492–502` 不检查 `isProtectedReconnectScheduled`，而详情及菜单检查。
`AppState+Connect.swift` 的重试父任务在 await connect 和 pending teardown 后才清 scheduled；connect 子任务
可以先发布 Connected、清 Connecting/blocked，形成短暂 `Connected && retryScheduled`。

这是同一屏幕的状态优先级差异，不代表连接实际未保护；没有升级成重大 fail-open 发现。
建议后续对徽章/指标补相同 retry guard，并对它们**实际使用的**投影加入该组合的回归，不只测详情。
按两轮审查停止规则保留 open，不再为 minor 开第三轮；UI/设备验收和该残余风险须随 PR 交接。
