| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-REPLACEMENT-HEAL-STATE | Windows 更换账户登录保留旧账户故障转移状态，下一次连接可能绕过已选服务器 | in-PR | hunt/sol-r3acct-account-heal | 中·已确认（P2） | 源码路径已复核；实际 Tauri 回归由 Windows CI 运行，本机未跑完整原生测试。需实机验证。 |

Baseline `3853f5ec`, `commands/account.rs:359`: replacement sign-in clears catalog/runtime but keeps `heal`. A prior ordinary failure selected a backup before arm; the user signs in with another email without signing out. Connect refuses an empty catalog before `heal::prepare` (`connection.rs:588–591`), so intermediate `routing=None` never resets it. After the new catalog installs the same preferred name and residential host/port, `Session::stick_to_preferred` (`tono-core/src/heal.rs:131`) preserves that old backup. Unarmed `dial_name` uses it when the new account's node list contains the name. It uses the new account's credentials, so this is an unexpected dial target, not a cross-account credential leak.

Reset the predecessor healer at replacement adoption exactly as successful sign-out does. One regression invokes actual adoption, reinstalls the matching new-account residential identity, and requires the selected dial plus cleared pending/tried state. Native WFP/DNS policy and release order are unchanged.
