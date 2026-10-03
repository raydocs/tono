| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-IDLE-QUIT-IPC-DELAY | Optional idle-Service shutdown silently holds Windows Quit open through long status/goodbye IPC deadlines | fixed(0c97eaa2) | hunt/sol-r3acct-idle-quit-budget | 中·已确认（P1，Linux wait regression） | Windows App/native quit execution requires CI/hardware; a timed-out already-sent Service request can still complete under existing server-side gates. |

Baseline `2bfa95d1`: `feat/window.rs:538` awaits optional Service shutdown after required release and Core cleanup, before `app.exit`. `commands/quit.rs:96` reads status (up to 32 seconds), then `:125` asks owner-goodbye (up to 95 seconds). A single stalled IPC delays this already-approved Quit with `is_exiting` suppressing normal events. `RunEvent::Exit`'s ten-second cleanup ceiling has not begun yet.

The whole optional wait now has a two-second budget. Timeout is logged and Quit continues. Required release/Core cleanup, strict/armed safety gates and Service wanted/desired-state admission are unchanged. A paused-clock regression fails with the original unbounded await and passes with the bounded production helper.
