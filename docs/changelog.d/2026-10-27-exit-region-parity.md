## 2026-10-27 · 跨平台出口地区规则共享夹具
- 归属：G2（连不上有下一手：故障转移与放行后重连留在用户所选地区）；Windows tono-core、Windows App/界面、macOS。
- 来源：基线 origin/main `db37c5877`；分支 `test/exit-region-parity`。
- 缺陷修复：XPLAT-EXIT-REGION-TOKEN-ORDER。Windows `heal::region_key` 与 `unarmed_probe::region_of` 改为与其余三处相同：显式 US 词优先于 JP。只影响同时含 US 与 JP 词的出口名。
- 新增/优化：无。
- 工程与测试：新增 `tooling/scripts/tests/fixtures/exit-region-v1/cases.json`（17 例：城市、hy2 后缀、前导空格、整词匹配、US+JP 同名）；由 tono-core `tests/exit_region_contract.rs`、`catalog_sync::region_rank_matches_whole_words_only`、`node-meta.test.ts`、macOS `ExitHealTests.testRegionKeyMatchesTheSharedExitRegionCases` 共同读取。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机；五处实现未合并为一处。
