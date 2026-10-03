## 2026-10-03 · 账本：383 条滞留 `in-PR` 的 finding 改为 `fixed(<merge sha>)`
- 归属：SHIP_PLAN §2 第 10 项（记录）；`docs/FINDINGS_LEDGER.md` 与 `docs/findings.d/`。
- 来源：基线 `5cc59600` → 分支 `docs/findings-status-20261003`。
- 缺陷修复：无（只改状态列）。
- 新增/优化：账本里 383 条 finding 停在 `in-PR`，但引用的 PR 早已合入（抽查 REL-GATE-MAC、SIGN-WIN-FLOOR-STRING、CR6e71 等，代码里已修）。按规则批量改状态：行里引用的 PR 已合入 → `fixed(<merge sha>)`（多个取最后合入的）；只引用分支 → 查该分支合入的 PR；只引用 issue → 用 GitHub 的 `closedByPullRequests`/关闭事件找到合入的 PR（24 条，全部由 `fix(...)` PR 关闭）；写「本 PR」或「编排器」→ 把该 ID 引入 main 的 merge commit（A13/M14/O1/EXIT-CLI 四条顺带把 Issue/PR 列补成实际 PR）。没有引用开着的 PR 或关闭未合 PR 的行，所以没有行改回 `open`。其余列（问题、等级、剩余限制）一字未动；剩余限制里写的 needs-hardware 仍然成立。
- 工程与测试修正：无。
- 验证：`node tooling/scripts/records.mjs findings` 解析通过，`in-PR` 剩 0 条；状态分布 fixed 659+、open 53、refuted 11、accepted-design 10。抽查 11 条高/中等级行，引用的 PR 全是已合入的 `fix(...)` PR。仅文档。
