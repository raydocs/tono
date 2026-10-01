## 2026-10-01 · RegLate (macOS) regression review report
- 归属：SHIP_PLAN §2 item 10; review record only.
- 来源：origin/main `0676435b` (first pass) and `b9ab47db` (refresh); branch `docs/claude-reglate-macos-report`; docs PR.
- 缺陷修复：无（report only）。Fixes are in #1231 (REGLATE-MAC-F1/F2, P3) and #1237 (REGLATE-MAC-F3, P2, helper 4.52.30); issues #1238, #1239 (P2) and #1240 (P3 release gate note).
- 新增/优化：`docs/agent-reports/2026-10-01-claude-reglate-macos.md` reviews the macOS-touching PRs merged since 04:45Z (through #1214) and records that the "selective hook not registered" gap is covered by the helper AI hold on every automatic release.
- 工程与测试：none.
- 验证：docs only; none.
- 候选/发布：无；未部署、发布。
- 剩余限制：code reading only; no XCTest, helper self-test or hardware run on the MacBook.
