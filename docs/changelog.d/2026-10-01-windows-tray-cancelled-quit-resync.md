## 2026-10-01 · Windows tray Quit re-syncs the App after a cancelled exit
- 归属：SHIP_PLAN §2 item 10; Windows App quit path (tray).
- 来源：origin/main 4bb0ba4a; branch `claude/r5-win-tray-quit-resync`; source PR, not yet merged.
- 缺陷修复：R5-WIN-TRAY-CANCELLED-QUIT-RESYNC. Tray menu Exit and the tray flyout Quit dropped `feat::quit()`'s Canceled outcome, so after "stay open" the catalog/policy periodic sync that `quit_release` retired never restarted and the Service reading was not folded back. All three user Quit entries (window close request, tray menu, tray flyout) now go through `feat::quit_or_resync()`.
- 新增/优化：无。Release, refusal dialog and exit budgets are unchanged.
- 工程与测试：one tokio regression for the shared `resync_if_cancelled` helper.
- 验证：rustfmt --check clean on the new code; cargo not run on the MacBook (AGENTS.md), hosted Windows CI pending.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：tray click on a real Windows desktop not exercised.
