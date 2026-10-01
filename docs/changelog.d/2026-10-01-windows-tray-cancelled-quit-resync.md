## 2026-10-01 · Windows tray Quit re-syncs the App after a cancelled exit
- 归属：SHIP_PLAN §2 item 10; Windows App quit path (tray).
- 来源：origin/main 4bb0ba4a; branch `claude/r5-win-tray-quit-resync`; source PR, not yet merged.
- 缺陷修复：R5-WIN-TRAY-CANCELLED-QUIT-RESYNC. Tray menu Exit and the tray flyout Quit dropped `feat::quit()`'s Canceled outcome, so after "stay open" the catalog/policy periodic sync that `quit_release` retired never restarted and the Service reading was not folded back. All three user Quit entries (window close request, tray menu, tray flyout) now go through `feat::quit_or_resync()`.
- 新增/优化：无。Release, refusal dialog and exit budgets are unchanged.
- 工程与测试：one tokio regression for the shared `resync_if_cancelled` helper.
- 验证：rustfmt --check clean on the new code; cargo not run on the MacBook (AGENTS.md), hosted Windows CI pending.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：tray click on a real Windows desktop not exercised.
- 续记（2026-10-01）：R5-WIN-PARALLEL-QUIT-FLOWS（Codex review of 9cdc5221）. `quit_or_resync()` is now single-flight over the whole Quit → cancelled-resync lifecycle; a second Quit from the tray or window while one is in flight returns without starting a parallel flow. One tokio regression `a_second_quit_while_one_is_in_flight_does_not_run`. Restart and the dev quit entry are not behind this guard.
