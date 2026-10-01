## 2026-10-01 · RegLate (Windows) and WinSvcIPC review report
- 归属：SHIP_PLAN §2 item 10; review record only.
- 来源：origin/main e2bf1603; docs/claude-reglate-windows-report; docs PR.
- 缺陷修复：无（report only）。Fixes are in #1221 (REG-1121, P1) and #1227 (sing-box DIRECT admission, P2); P2 issues #1228, #1229.
- 新增/优化：`docs/agent-reports/2026-10-01-claude-reglate-windows.md`, which reviews the 50 Windows-touching PRs merged since 04:45Z (sing-box set and #1188 included) and covers the Service IPC, SCM stop and shutdown paths.
- 工程与测试：none.
- 验证：docs only; none.
- 候选/发布：无；未部署、发布。
- 剩余限制：Service desired/manager/structure/runstate were read only at their call sites; there was no hardware run.
