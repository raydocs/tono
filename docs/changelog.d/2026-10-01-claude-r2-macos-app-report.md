## 2026-10-01 · Round 2 macOS app hunt report (Claude)
- 归属：SHIP_PLAN §2 item 10; review record only.
- 来源：origin/main `626b1d74` (scope unchanged at `c57f00c0`); branch `hunt/claude-r2-macos-app`; docs PR.
- 缺陷修复：无（report only）。No new P0/P1/P2; 14 hypotheses checked, 3 known items seen again (#1071, #1057, #1052).
- 新增/优化：`docs/agent-reports/2026-10-01-claude-r2-macos-app.md` covers app-side connect/disconnect/reconnect, native update, catalog/policy apply, AccountSession, health monitor and system DNS/proxy.
- 工程与测试：none.
- 验证：docs only; none.
- 候选/发布：无；未部署、发布。
- 剩余限制：code reading only; RuntimeCleanup, Persistence, Subscriptions and RouteChoices only partly read; no XCTest or hardware run.
