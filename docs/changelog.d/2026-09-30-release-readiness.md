## 2026-09-30 · 发布就绪差距清单

- 归属：SHIP_PLAN 客户 0.0.74 的差距记录，不是 G4，也不勾 SHIP_PLAN §6。
- 来源：`main` `5c32a4b1` → 本分支；[#750](https://github.com/raydocs/tono/pull/750)；未合 main。对照当天开放 PR。HY2 保活是 [#749](https://github.com/raydocs/tono/pull/749)。
- 缺陷修复：无。
- 新增/优化：新增 [RELEASE_READINESS.md](../RELEASE_READINESS.md)。每项标 `done` / `in-PR (#N)` / `needs-real-hardware`；本轮不做的标 `later`。#706 未合，仪表盘「选择其他线路」记为以后再删。
- 工程与测试：只改文档。不跑产品测试。
- 验证：清单与 `gh pr list`（2026-09-30）和已合的 #704、#705、#736 对齐。未在真机上复查任何网络行为。
- 候选/发布：仅文档，无新候选。
- 剩余限制：开放 PR 合入后状态会过时。`needs-real-hardware` 的项本文不能代替实机。
