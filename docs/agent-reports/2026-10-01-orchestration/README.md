# 2026-10-01 编排与报告存档（box 迁出）

这些文件原来只在共享 box 上（`/workspace/orchestrator/`、`/workspace/merge-work/`、`/workspace/w1-codex/` 等），用户改为在本地工作前统一迁到仓库。快照时间 2026-09-30 23:30 MT。只是记录，不是 merge、部署或发布的授权；内容是各代理当时的自述，以 GitHub 上的 PR/Issue 状态为准。

已做密钥扫描（gitleaks 8.30.1 + 正则）：没有令牌、凭据或 `.env`。脚本里只剩本机路径和 `gh auth git-credential` 这类调用，不含任何密钥值。

## 顶层文件

| 文件 | 内容 |
|---|---|
| `COVERAGE.md` | 编排器的覆盖表：每个模块/区域分给了哪个槽位（Codex、Grok 云代理等）、查到哪一轮、结论。 |
| `LEDGER.md` | 编排器总账：每条假设/发现的判定（real / FP / dup）、对应 PR 或 Issue。 |
| `W1_CODEX_STATUS.md` | Codex 执行器（账号 2）W1/W2/R3/R4 各槽位的状态表：开始/结束时间、发现数、开出的 PR。 |
| `STATUS-2110.md` | 合并管理器 21:10 MT 的合并扫尾状态：已合数量、main CI 情况、修复前进的破坏、仍失败的 PR。 |
| `merged_recent.tsv`、`open_prs.tsv`、`pr_states.txt` | 编排器做分派时抓的 PR 快照（最近合入、开放 PR、状态）。 |
| `cloud-agent-transcripts-index.tsv` | Cursor 云代理会话记录的索引（ID、字节数、行数、时间）。原始 `*.jsonl`（共 37 个，约 77 MB）太大，未提交。 |

## 子目录

- `claims/claims.tsv`：编排器的槽位认领表（`/workspace/orchestrator/claims/<slot>/owner` 合并成一张表），记录每个槽位由谁（Codex 账号、哪个 Grok 云代理）在什么时间认领。
- `prompts/`：分派给各槽位的提示词。`<slot>.md` 是区域说明，`full_<slot>.md` 是拼上 `_common.md` 公共规则后的完整提示词，`reply_bc-*.md` 是发给云代理的追加回复。
- `codex-findings/`：Codex 执行器生成的报告（`/workspace/w1-codex/report-out/`）。
  - `codex-<slot>-findings.md`：每个槽位逐条假设的判定和证据，最新版本（main 上 `docs/agent-reports/` 里的是较早的版本；R4 槽位的是第一次入库）。
  - `codex-ledger.md`、`codex-coverage.md`：Codex 侧的汇总账和覆盖表。
  - `codex-R3-RegWin-*report.md`、`codex-R3-A5A6-*report.md`：之前没入库的槽位最终报告。
  - `W1_CODEX_STATUS-codex1-r3.md`：Codex 账号 1 的 R3 四个槽位（M4/M13/C7c/T1）因额度耗尽中止时的状态（原来只在一个本地 stash 里）。
- `scripts/merge-manager/`：box 上合并管理器用的脚本（原 `/workspace/merge-work/bin/`）。
  - `mgr2.py`：管理器 v2 主循环——对排队/请求自动合并的 PR 开自动合并，修 DIRTY（DECISIONS 变基、helper 版本 bump），失败的 ci-gate 重跑一次后评论并跳过，批量合入全绿的纯文档 PR，盯 main CI。
  - `ratchet-check.sh`：把 PR 头和 origin/main 合并后跑 unchecked-index 棘轮，对比 main 报出新增错误。
  - `aux*.sh`：每 2 分钟把新的请求自动合并的 PR 入队、重定向基 PR 已合的堆叠 PR、跑标签器。
  - `snap.sh`：每 5 分钟在 `ci/main-snapshot` 上对当前 main 派发一次完整 ci-gate 并记录结果。
  - `manager.sh`（v1 槽位管理器）、`prio.sh`、`sweep.sh`、`fastoff.sh`：较早的串行化/更新分支循环。
  - `bumphelper.sh`、`helperhash.sh`、`rebase.sh`、`decmerge.py`：解决 `HelperProtocolVersion`/`CONTRACT` 和 `docs/DECISIONS.md` 冲突的工具。
  - `classify.py`：把开放 PR 分成纯文档/测试与代码两类。
  - 其余（`st.sh`、`wait.sh`、`watch*.sh`、`w2.sh`、`loop.sh`、`push.sh`、`restart-mgr2.sh`、`start-aux3.sh`、`swap-aux.sh`、`win-candidate-wait.sh`）：查看状态、等待事件、重启循环、等 #1079 合入后触发 Windows 候选构建的小工具。
- `scripts/codex-executor/`：Codex 执行器的槽位脚本（原 `/workspace/w1-codex/`）。`launch.sh` 认领槽位并启动 `codex exec`，`setup_slot.sh` 为每个槽位建独立克隆（`GIT_DIR`/`GIT_WORK_TREE`，无 `.git`），`addendum.md` 是追加给每个槽位的执行规则，`scheduler.sh`/`mon.sh`/`audit.sh` 排队与巡检，`report.py`/`finalize.py`/`push_docs.sh` 生成并推送报告，`salvage_check.sh` 检查中断槽位的残留改动。
- `extra/`：只在 box 上的云代理产出报告：`ops-1-vs-ops-2-audit.md`（两个 ops 控制台方案对比审计）、`tono-ui-proposal-2026-09-30.md`（Windows 客户端界面改进提案，截图未提交）、`windows-sing-box-1.15.0-alpha.9-evaluation.md`（Windows 端 sing-box 1.15.0-alpha.9 评估）。

## 未提交

- `cloud-agent-transcripts/*.jsonl`：原始会话记录，太大，只留上面的索引。
- 各槽位 `runs/`（`stream.jsonl`、`stderr.log`）、`out/` 下的中间日志和 JSON、合并管理器的 `*.log`/队列状态文件：运行时产物，不是报告。
- 已在 main 上的报告（bughunt/bakeoff 报告、R3 账号 1 的 COVERAGE/LEDGER、内容相同的 Codex `*-report.md`）不重复提交。
