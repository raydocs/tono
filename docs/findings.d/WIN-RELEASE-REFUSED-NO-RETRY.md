| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RELEASE-REFUSED-NO-RETRY | 健康失败后 Service 拒绝释放（DNS 还原证明不了）时，App 只记日志，保护屏障一直留着且无人再试 | open | [#1599](https://github.com/raydocs/tono/pull/1599) | 高·推导 | 待实机：换 Wi-Fi（热点 → 酒店/办公室）后确认重试在 2 秒节拍内放行，且不绕过 Service 的 `still_on_loopback=true` 硬拒绝 |

换 Wi-Fi 时网卡抖动会让 `ensure_restored` 的适配器证明失败；`accepts_degraded_restore` 需要连续 3 次实时应用失败，而没有重试时这个计数永远到不了 3。
修复在 `monitor.rs` 的 `settle_health_release`：拒绝后按监控节拍重复同一个释放，会话被用户结束、被新连接或新代号取代即停止，成功后进入原有的无隧道探测。Service 一侧的门不变（Service 侧 DHCP 回退仍在 #1590）。
