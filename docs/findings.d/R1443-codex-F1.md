| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1443-codex-F1 | BRICK-W6 回滚的资格复核只拦住了仍在库中的已采纳记录；若就绪超时后稍晚启动的后继已 Adopt，并且 Disconnect 已把记录退役，`consumed_attempt()` 报错，执行器转入停服释放收尾，会停掉已经可用的 Service | open | [#1443](https://github.com/raydocs/tono/pull/1443) | 低·推导（读码，jev-route 0d5639cf 确认） | jev-route 停止规则：一轮修复后仍开；需要就绪超时、后继 Adopt、Disconnect 退役三者都发生在执行器重取 repair 锁之前 |

来源：jev-route review 5de575f1 codex:F1 的复报（0d5639cf codex:F1），`apps/windows/service/src/bin/install_service/update_executor.rs` 中 `restore_predecessor_after_unready_replacement` 的资格判断。修法：没有记录（或记录不再是本次尝试）同样按"不回滚、不停服"返回。
