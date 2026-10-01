## 2026-10-01 · Sparkle 发布门核对 zip 里的 app
- 归属：SHIP_PLAN §2 第 10 项。发布工具。
- 来源：`cursor/appcast-require-release-gate-d3c7` `58823ab9`（[#939](https://github.com/raydocs/tono/pull/939)）。本分支 [#952](https://github.com/raydocs/tono/pull/952)。未合 main。
- 缺陷修复：写 feed 前，从正在发布的 zip 读出 `Tono.app` 的文件字节，必须与 `--app` 逐文件相同，发布门跑在解出来的那份上。关联 REL-APPCAST-GATE。
- 新增/优化：无。
- 工程与测试：`the release gate sees the app inside the zip, not a different --app`。
- 验证：`node --test tooling/scripts/tests/publish-macos-appcast-gate.test.mjs` 2 passed。
- 候选/发布：仅源码，无新候选。
- 剩余限制：比较的是文件字节和符号链接文本，不含资源叉。未实机。
