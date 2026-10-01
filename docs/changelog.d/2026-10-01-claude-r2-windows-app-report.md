## 2026-10-01 · Round-2 Windows App connection layer hunt report
- 归属：SHIP_PLAN §2 item 10; review record only.
- 来源：origin/main 626b1d74; docs/claude-r2-windows-app-report; docs PR.
- 缺陷修复：无（report only）。Fixes are in #1253 (WIN-SINGBOX-DIRECT-LOCKED-PERMIT-MONITOR, P2, the #1245 leftover) and #1257 (WIN-SINGBOX-REPLACE-LOCK-RACE, P1 推导); P2 issue #1258 (fake-IP store lost on the sing-box replacement).
- 新增/优化：`docs/agent-reports/2026-10-01-claude-r2-windows-app.md`.
- 工程与测试：none.
- 验证：docs only; none.
- 候选/发布：无；未部署、发布。
- 剩余限制：No hardware run. restore/reconnect were read only along the sing-box paths; unarmed_probe, probes and the tray wiring were not read.
