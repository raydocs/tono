## 2026-10-10 · 发现账本 open 项状态清理（Amp backlog A15）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp backlog A15；仅文档（`docs/findings.d/`、`docs/FINDINGS_LEDGER.md`）。
- 来源：基线 origin/main `4e373f06`；分支 `amp/a15-findings-status-sweep`。不改代码。
- 缺陷修复：无代码改动。逐条核对 73 条 `open`（分片 + 总账行）与 3 条 `in-PR`，只在修复 PR 已合 main 时改状态：
  - `open` → `fixed`：R3-O1（`cc45bf4f`，#769，与 WIN-DNS-SNAPSHOT-DELETE-BLOCKS 同根因）、BRICK-M10（`52136e58`，#701/#710）、
    I-UI0075-R3-O-F6（`c8911d9c`，#1426）。
  - `in-PR` → `fixed`：WIN-LOG-UPLOAD-PROBE-LINES（`5468ddb8`，#1193）、WIN-AUTH-CN-CF-PATH（`43476cb3`，#1462/#1465，macOS #1463/#1464）。
  - `in-PR` → `open`：BRICK-M1（#679、#1444 已合，其余部分无修复 PR，同 D7 惯例）。
  - 其余 70 条仍 `open`：没有合入 main 的修复（含部分修复、所有者待决、需实机实验、backlog 待做项）；BRICK-W5 只补记 #1437 已合。
- 新增/优化：`findings.d/README.md` 写明「已进 main、只差实机」用 `fixed(<SHA>)` + 剩余限制「待实机」，不新增状态值。
- 工程与测试：无。
- 验证：`node tooling/scripts/records.mjs findings` 改前改后都能解析（exit 0）；`--status open` 73 → 71 行（70 条原 open + BRICK-M1），`--status in-PR` 3 → 0。
  产品测试不适用（仅文档）。
- 候选/发布：仅文档，无新候选。
- 剩余限制：核对依据为 `git log --grep`、`gh pr list --search <ID>`、分片引用 PR 的合并状态与对应源码位置抽查；修复若以别的 ID 合入且未提本 ID，
  可能漏判（R3-O1 即此类）。标为 fixed 的 5 条均未实机验证。
