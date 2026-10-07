## 2026-10-07 · 音效默认开、进 0.0.76；0.0.75 候选只带 Mac polish A
- Status: owner
- Chosen: 老板 2026-10-07 原话「音效默认开 进 0.0.76 把能合并的合并出候选」。(1) 连接音效（连接成功 / 断开 / 失败或被拦截，可选「更新就绪」）两端都做，设置里可关，默认开，遵从系统静音；归 0.0.76，不进 0.0.75 冻结范围，不受 G4 冻结影响前不开工。(2) 0.0.75 候选现在就出：先从 main `f73300c13`（#1430 合并提交，含 Mac polish A #1426）以序列 7502 出，两端构建都失败（macOS release 工作流缺 XCTest 的 hosted-window 标志，Windows NSIS 模板没跟上 tauri-cli 2.12.1；见 [2026-10-07-macos-release-hosted-window-flag.md](../changelog.d/2026-10-07-macos-release-hosted-window-flag.md)），修复合入为 main `a990641df`（#1431），`stability/desktop-0.0.75-20261005`、`release/macos`、`release/windows` 快进到该 SHA，以序列 7503 重出；7502 作废不复用（7501 已被 `e28ca45c` 候选占用，序列只增）。Mac polish B–D（#1429 起）归 0.0.76。(3) 可合并的都已合并：#1429 是 Codex 的 B 草稿、无 §4 证据，不合；#1424（dependabot）按既有指示不合。
- Rejected: 等 B–D 做完再出候选（老板要现在出）；音效默认关（老板定默认开）；复用 7501 序列。
- Why stricter: 新包是新候选，老板对 7501 的任何查看不转为 7503 的验收；客户 feed、tag、草稿 publish 一律不动，直到 SHIP_PLAN §6 G1/G2 有老板的 `[x]` 且证据指名 `a990641df` / 7503 两包哈希。
- Applied in: 候选记录 `docs/changelog.d/2026-10-07-candidates-0075-a990641d.md`；音效实现在 0.0.76 的 PR 引用本决策。
