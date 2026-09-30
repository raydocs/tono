| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-HEARTBEAT-REVISION-STOP | Windows DIRECT 策略只更新 revision 时不触发重连，却因原始 JSON digest 改变停止续租，Service 租约到期后将健康会话置为 Blocked | in-PR | 待开 | 高·推导 | Windows Rust 回归未运行，hosted Windows CI 待跑；租约与策略重新签发需 Windows 实机，needs-hardware |

心跳保留已提交的已验证策略，按当前已验证策略行为比较；revision 变化而行为不变时继续续租，行为改变仍停止心跳并走既有 `handle_policy_behavior_change`。归属 SHIP_PLAN §2 第 10 项 / G1 Windows DIRECT；仅源码，未合 main，无新候选。
