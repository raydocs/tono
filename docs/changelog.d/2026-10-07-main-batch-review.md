## 2026-10-07 · main 合批记录与合并回归评审（c8911d9c…6df21302）
- 归属：`docs/SHIP_PLAN.md` 0.0.75；AGENTS「Finish the work」第 1 条（每批合并后的合并回归评审、记录已评审区间）。仅记录，无源码改动。
- 来源：上一段已评审区间止于 `c8911d9c5`（#1426 Mac polish A，run 1fe232d2）。本批到 `6df213029ec1e02d942987c2d3ccb2e3e8fd25f4`，五个 merge commit：

  | PR | 内容 | main merge | PR 评审 |
  | --- | --- | --- | --- |
  | [#1430](https://github.com/raydocs/tono/pull/1430) | 记录（文档） | `f73300c13` | f8ca8505 PASSED |
  | [#1431](https://github.com/raydocs/tono/pull/1431) | 7502 两端构建失败修复：macos-release.yml XCTest hosted-window 标志；NSIS 模板同步 tauri-cli 2.12.1 | `a990641df` | a9401457 → 789d75bb PASSED |
  | [#1432](https://github.com/raydocs/tono/pull/1432) | 控制面依赖：source-map-js 1.2.2、undici 7.29.1（vitest-pool-workers 作用域 override） | `8daae5dd3` | PASSED（single） |
  | [#1433](https://github.com/raydocs/tono/pull/1433) | NSIS 模板与 `@tauri-apps/cli` 版本同步守卫测试 | `30ee93a93` | d8465421 PASSED |
  | [#1434](https://github.com/raydocs/tono/pull/1434) | Windows 卸载清理 sing-box 摘要钉（#1319） | `6df213029` | bb025cee PASSED |

- 合并回归评审：`route.mjs review-run start --git c8911d9c5...6df213029 --pr 1430,1431,1432,1433,1434`，decision `586f21f9`，dual_cross_family（opus high + codex high，无替换），0 findings，PASSED。已评审区间现在止于 `6df213029`。
- 验证：每个 PR 的 ci-gate 在准确 head 成功、回执评论含 merge record；无未解线程。`a990641df` 之后的 #1432–#1434 不在 7503 候选包内（[候选记录](2026-10-07-candidates-0075-a990641d.md)）。控制面自 `94817af4f` 后的 Worker 变更（#1432 依赖）尚未部署，随 #1435 合入后一并部署。
- 剩余限制：合批评审只覆盖 diff，不替代实机验收。
