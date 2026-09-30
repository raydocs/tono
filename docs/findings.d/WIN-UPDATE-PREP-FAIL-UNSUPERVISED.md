| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-PREP-FAIL-UNSUPERVISED | Windows 更新先取消监控与 DIRECT 心跳，Prepare 在停止 Core 前失败时仍显示 Connected，租约到期后可全阻断且无人恢复 | in-PR | #779 | 高·推导 | 仅源码；未运行 Windows 回归或实机 DNS/WFP；不可读 Core 快照不折叠 Connected，释放被拒时保持真实武装状态 |

`invalidate_connection(false)` 取消 reconnect、network monitor、DIRECT heartbeat、pin refresh、switch 与 protection resync，更新另停 catalog sync；原收敛只在 Core 不运行时折叠 Connected。

准备未取得有效 `InstallationAuthorized` 收据且快照确认 Core 仍运行时，本次取消的同代际 Connected 经 `tunnel_died` 退出，再进入现有带更新账本的有序 Disconnect 释放。Preparing 账本会拒绝普通生命周期操作及 DIRECT 续租，单独重启监控无法恢复；本修复不依赖 Service 的租约到期放行改动。释放准入再次核对代际，Install 丢失确认不触发此路径。回归：`failed_prepare_with_running_core_releases_only_the_unsupervised_session`。
