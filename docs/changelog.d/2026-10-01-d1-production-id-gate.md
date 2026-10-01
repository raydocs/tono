## 2026-10-01 · Refuse the production D1 id in wipe and preview restore
- 归属：ops plan（D1 备份与 preview 恢复，`docs/ops/restore-production.md`）；控制面脚本，不改迁移。
- 来源：origin/main b341164b → cursor/d1-wipe-production-id-f6c6；https://github.com/raydocs/tono/pull/943；未合 main。
- 缺陷修复：清空脚本和 preview 恢复只把库名 `tono-control-plane` 与绑定 `DB` 当生产库。Wrangler 会把 `wrangler.jsonc` 里的 `database_id` 解析成线上 D1，两道门都不在时也会执行。preview 配置若沿用该 id，恢复脚本的 `migrations apply` 会改到生产库。现在该 id 与库名同一道拒绝，preview 配置里出现它则在任何远程调用前停止。
- 新增/优化：无。两道门都打开时仍可对生产库做有意清空。
- 工程与测试：`wipe-d1-in-order` 与 `restore-control-plane-d1-preview` 各一条回归。
- 验证：Node 22 / Linux；`node --test tooling/scripts/tests/wipe-d1-in-order.test.mjs tooling/scripts/tests/restore-control-plane-d1-preview.test.mjs` 26 passed。未对远程 D1 执行。
- 候选/发布：仅源码，无新候选；不部署。
- 剩余限制：见 `docs/findings.d/C8-G-F1.md`。
