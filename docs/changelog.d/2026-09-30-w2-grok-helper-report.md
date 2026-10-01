## 2026-09-30 · W2 Grok helper 排查报告
- 归属：SHIP_PLAN §2 item 10 的排查记录，不是客户发布。macOS root helper。
- 来源：基线 `71bd69d8`（报告正文对照 `36844a4a`，其间 helper 源码未变）→ 分支 `hunt/grok-helper-report-6122`，[#920](https://github.com/raydocs/tono/pull/920)。修复在 [#889](https://github.com/raydocs/tono/pull/889)（头 `87181a2d`），未合 main。不开 auto-merge。
- 缺陷修复：无新行为。报告记下已修的 MAC-ARM-PRELOAD-RELEASE、MAC-HEALTH-UNPROVEN-DOWN，以及未修的 #893–#897。
- 新增/优化：无。
- 工程与测试：只加文档和 findings 分片。没有跑 Swift。
- 验证：报告与 issue 链接核对到 GitHub。helper 自测未在本机执行。
- 候选/发布：无新包。
- 剩余限制：#889 的 `needs-hardware` 标签因令牌 403 没打上；auto-merge 已开且本报告不再改它。

## 2026-10-01 · 续记
- 归属：同一份 SHIP_PLAN §2 item 10 排查记录。
- 来源：M1 复核晚到。`origin/main` 上 `SocketServer.stageAndUpgrade` 仍是阻塞 `open`。#763 的 diff 不含 `SocketServer.swift`。
- 缺陷修复：无新行为。新开 [#928](https://github.com/raydocs/tono/issues/928)（MAC-UPGRADE-FIFO-OPEN）。不另开 helper PR。
- 新增/优化：无。
- 工程与测试：只补报告和 findings 分片。
- 验证：读源码。没有在 Mac 上执行 FIFO。issue 正文里的 LaunchServices 路径写错；`gh issue edit` 与评论接口都是 403，正确路径写在本报告。
- 候选/发布：无新包。
- 剩余限制：等 #889 合入后再改协议号。
