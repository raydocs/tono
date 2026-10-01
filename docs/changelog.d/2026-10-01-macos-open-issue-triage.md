## 2026-10-01 · macOS 应用侧未认领 issue 清点（Grok）

- 归属：运维记录，非 SHIP_PLAN 发版门。不改产品行为。
- 来源：对照 `origin/main` `b341164b`。当时开着 38 个 issue、122 个 PR。报告在 `docs/agent-reports/macos-open-issues-grok.md`，[#940](https://github.com/raydocs/tono/pull/940)。未合 main。
- 缺陷修复：无。符合条件、可以动手的 macOS 应用缺陷是空的。#864 / #863 仍在 main 上，但已有开着的修复 PR。
- 新增/优化：无。
- 工程与测试：无产品代码，未跑 `xcodebuild`。
- 验证：`gh issue list` 与开着的 PR 正文检索 `#N`。main 上仍能看到 `waitForOwnedTunnelInterface` 和健康心跳里的 `errorMessage = nil`。
- 候选/发布：无新包，仅文档。
- 剩余限制：不关闭任何 issue。#817 仍未对照 sing-box 证实，没有改路由。
