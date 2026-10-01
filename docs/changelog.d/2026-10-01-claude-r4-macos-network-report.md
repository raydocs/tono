## 2026-10-01 · Round 4 macOS network/power hunt report
- 归属：SHIP_PLAN §2 item 10；macOS 网络变化、睡眠唤醒、DNS 接管与 fail-open。
- 来源：origin/main 509ebde2；分支 claude/r4-macos-network-report；仅文档。
- 缺陷修复：无（本 PR 只记录）。修复在 #1285（MAC-DNS-PAUSE-HOLDS-PF）、#1286（MAC-PAUSED-OPEN-STATUS）；决策项 #1287（MAC-PAUSE-WATCHDOG-STALE-BLOCK）。
- 新增/优化：报告 `docs/agent-reports/2026-10-01-claude-r4-macos-network.md`；新发现分片 MAC-PAUSE-WATCHDOG-STALE-BLOCK。
- 工程与测试：无。
- 验证：仅源码阅读；未在本机运行任何改网络的命令。
- 候选/发布：无。
- 剩余限制：见报告「Open risks」。
