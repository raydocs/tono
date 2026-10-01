| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STOPCLASH-UNRECORDED | StopClash 在 Core 已确认停止后若写 desired state 失败，就在恢复 DNS 之前返回，解析仍指向已死的 198.18.0.2 | open | 待开 | 高·推导 | 保持会话时重启失败只恢复 DNS 并留下当时的 WFP；不重试那次失败的记账 |

`StopClash` 在 `stop_core` 成功之后调用 `persist_owner_core_stopped`。失败分支原先把生命周期标成 Fatal 并返回，`macos_kill_switch::transition_after_stop` 与 `windows_kill_switch::transition_after_stop` 都不会跑。Core 已经不在，看门狗也在 `stop_core` 里停了，DNS 仍停在保护地址。这不是 #866：那条是释放路径上 Core 停止未确认时的 DNS 补偿。也不是 #829：这里不在记账失败时拆掉 WFP。
