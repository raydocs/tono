| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STARTUP-AUTH-SUPERSESSION | 延迟的 Windows 启动恢复在 Adopt 后抢占已开始的交互登录，令验证码请求失效或清掉挑战 | in-PR | hunt/sol-r3acct-startup-auth | 中·已确认（P2） | Linux 精确函数/回归夹具已先失败后通过；完整 Tauri 状态回归由 Windows CI 验证。 |

Baseline `20ce5d1a`: `commands/restore.rs:116` awaits update adoption before incrementing authentication generation at `:128`. Startup pin hydration also precedes that increment. An interactive `begin_sign_in` (`commands/account.rs:337`) during either wait owns the earlier generation; late startup then supersedes it. Its email reply is rejected, or the tokenless restore clears its already-issued challenge through Missing-account cleanup.

Reserve startup's initial generation before adoption, recheck after adoption and before seeding, and refuse startup after any newer auth action. Independent update adoption still runs even if interactive auth owns the account. Explicit restore retries remain able to reserve a new transaction. Regression uses a controlled adoption barrier and actual native sign-in admission; no PF/WFP/DNS behavior changes.
