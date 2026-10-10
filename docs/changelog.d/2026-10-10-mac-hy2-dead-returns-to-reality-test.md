## 2026-10-10 · macOS：补「hy2 不通 → 回到同一节点的 Reality TCP 块」的回归测试（审计确认现有行为，无代码改动）
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计第 2 项，延续 [Amp backlog](../ops/amp-backlog-2026-10-10.md) A17 / #1499 与 H21-O-F4、R4SW-MAC-HY2-PROBE）；macOS App 测试。
- 来源：origin/main `3d973f95` → 分支 `amp/cn7-hy2-dead-returns-to-reality`，[#1534](https://github.com/raydocs/tono/pull/1534)；未合 main。
- 缺陷修复：无。审计确认（只读代码）：UDP 全不通时，用户手选的 ` · hy2` 块 armed 连接失败 → `applyExhaustedArmedFailure` 释放并进入未 armed 循环；
  `UnarmedReconnect.tcpCandidateNames` 把 hy2 名映射到同节点的 Reality 基名放在第一位、hy2 块不参与 TCP 证明；证明通过后选择改回 Reality 并拨号。
  不引入新协议，不改节点 :443 的 tono-xray。此前没有测试覆盖「首选是 hy2」这一入口（现有测试只覆盖记住的 hy2 不遮挡 TCP 候选）。
- 新增/优化：无。
- 工程与测试：`ArmedFailureReleaseTests.testADeadHy2SelectionReconnectsOnTheSameNodesRealityBlock`（模拟：TCP 证明注入，准入在任何特权操作前截住）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：审计另见未修（只在 A17 开关开时）：记住的 hy2 在健康检查里死掉后，未 armed 循环证明 Reality 通过、`connect` 里 A17 仍按 24 h 记忆再拨一次 hy2，多付一轮约 24 s 的验证才回到 TCP；
  A17 的「连续失败计数」只认 `coreExitUnreachable`，连接阶段的 sing-box 延迟门被挂起时可能永远不计数（待实机确认）。
