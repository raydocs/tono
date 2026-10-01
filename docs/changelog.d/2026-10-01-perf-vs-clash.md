## 2026-10-01 · 相对 Clash 的速度记录

- 归属：SHIP_PLAN G1（已连接=能用）；只记测量和四条性能 PR，不改运行时。
- 来源：main `6c6d1589`；分支 `cursor/perf-vs-clash-report-10e8`；未合 main。
- 缺陷修复：无。
- 新增/优化：无。
- 工程与测试：报告在 `docs/agent-reports/2026-10-01-perf-vs-clash.md`。数字来自同日 Linux 回环，不是真机。
- 验证：文档。没有跑产品测试。
- 候选/发布：无新包。
- 剩余限制：四条代码 PR 都是 needs-hardware，未合并。gVisor 窗口要等核心重编才进已安装的二进制。
