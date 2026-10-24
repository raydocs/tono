| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-STATE-AUTHORITY | iOS 以 NE 状态、App 探测与共享 snapshot 分别判断当前连接，缺乏统一隧道确认及会话代次约束；第一版归并实现还允许旧正向回复覆盖新无答 | in-PR | #1672（已合 e24adbc21）；fix/t1-ios-state | 高·源码推导；第一版晚答复活由本地回归确认 | 本地统一确认与会话隔离实现及 110 项 Foundation 单测已通过，尚未冻结/推送；`2026-10-19-ios-state-authority-plan.md` 覆盖故障矩阵及原始红/绿收据；App/扩展未原生编译、UI 未执行，故本项保持 open。历史 r9–r11 否决保留各自 finding，本项记录跨表面统一确认的架构缺口，不把新增工程缺陷重复算为已发布客户 bug。模拟器/真实 NE/真机未验证 |

2026-10-24（T1 · fix/t1-ios-state）：统一隧道确认与会话/代次约束已随 #1672 合入 main（`ConfirmationTracker`、`AppStatus.resolve`、`SharedStatus` 按 session+generation 比较；feat/ios CI run 39552258167 原生编译与 TonoKit 通过）。剩下的缺口是用户意图：用户断开/退出登录后更晚的隧道负面报告仍按时间胜出。本 PR 加 `TunnelIntentLedger` 与 `SharedStatus.governs` 的意图优先规则（见 `IOS-USER-DISCONNECT-CORE-STOPPED`、`IOS-SIGNOUT-WIDGET-OFF`、`IOS-STALE-FAILURE-AFTER-RECOVERY`）。模拟器/真实 NE/真机仍未验证。
