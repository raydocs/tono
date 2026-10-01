## 2026-09-30 · 产品决定拆成每条一个文件
- 归属：工程（质量门，ops 计划外）；只动文档和 `tooling/scripts/records.mjs`。不影响客户端、Worker 或发布门。
- 来源：`origin/main` `c26025ec` → 分支 `qg/decisions-split`。
- 缺陷修复：无。
- 新增/优化：无。
- 工程与测试：`docs/DECISIONS.md` 不再承载正文，改为索引，并保留拆分时的 38 条标题，旧的 `#anchor` 仍指向这里。正文在 `docs/decisions/NNN-YYYY-MM-DD-slug.md`，编号沿原文件顺序，数字大的在前；新决定用下一个编号，不改别人的文件，也不往索引里追加标题。相对链接下移一层。`node tooling/scripts/records.mjs decisions` 按编号从高到低读出。AGENTS.md、docs/README.md、SHIP_PLAN、RELEASE_LINES、RELEASE_READINESS 和两个 provisioning skill 改为「新加文件」。
- 验证：`node --test tooling/scripts/tests/records.test.mjs`。拆分后把链接前缀还原，与拆分前 38 条正文逐字一致。
- 候选/发布：仅源码，无新候选。
- 剩余限制：已打开且仍改 `docs/DECISIONS.md` 的 PR 会在这份索引上冲突，正文需要改放到新文件里。历史 changelog 里对旧路径的叙述没有改写。
