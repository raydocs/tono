| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WAKE-SWITCH-DEFERRED-REBUILD | Windows 唤醒等网络变化的两次探测失败恰逢节点切换进行中：事件重建让给切换（`RecoveredInPlace`），但仍占用每小时 3 次的事件重建名额并标记线路不稳，失败计数清零 | open | 待开 | 低·推导 | 只读码（`connection/monitor.rs` Rebuild 分支先 `gate_event_rebuild` 记名额与 `note_route_probe_failure`，再由 `capture_health_context` 因切换未完成返回 `RecoveredInPlace`）；切换自身的探测通常覆盖新出口，否则由 30 s 周期探测兜底，未见卡死或泄漏；实现归连接稳定性线程，本 PR 不改 monitor |

补充：若切换的数据面证明发生在唤醒之前，唤醒后的首次失败要等下一次周期探测（≤30 s，再加一次确认）才会重建；
期间仍显示 Connected。修复方向：只有真正执行了重建才记入名额。需 Windows 实机睡眠/唤醒复现。
