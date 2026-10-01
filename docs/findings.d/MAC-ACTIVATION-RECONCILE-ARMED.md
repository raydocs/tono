| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ACTIVATION-RECONCILE-ARMED | macOS 前台激活对账默认按已 arm 处理，从未 arm 的会话会把 helper 的 confirmed(false) 当作外部释放而丢掉连接意图 | in-PR | 分支 `codex/macos-connect-recovery-fixes` | 中·推导 | 传入 `KillSwitchService.isArmed`；需托管 macOS CI |

来源：GLM-5.3 bug hunt #4（~1926-1938），main `ba7c8ae1`。
