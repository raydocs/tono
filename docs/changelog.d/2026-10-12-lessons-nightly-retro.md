## 2026-10-12 · 错题本 docs/LESSONS.md 与每晚复盘
- 归属：工程流程（不属于 SHIP_PLAN 门或运维计划条目）；所有者 2026-10-12 要求照搬 magpie 的错题本与验收做法，并减少等 CI。
- 新增/优化：`docs/LESSONS.md` 记录 agent 犯过的错（返工、不该合、验证太弱），每条一句规则加 PR/commit/run 证据和 `Seen N×`；同一条在 3 个不同日子出现即移入 AGENTS.md「Promoted lessons」。每晚复盘提示词 `docs/ops/nightly-retro.md`，入口 `tooling/scripts/nightly-retro.sh`（在 origin/main 的临时 worktree 里跑 `claude -p`，只改 LESSONS.md 的 PR 自动合并，升级规则的 PR 留给所有者）。
- AGENTS.md：修复、审查、合并前读 LESSONS.md；自动合并加 `--match-head-commit <已检查的 head SHA>`；开启自动合并后不等 CI，转做下一项，检查失败再回来；合并前留一条验证评论（`Red check:` / `Ran:` / `Not run:`）；夜审 PR 免 changelog.d 条目。
- 首条错题（Seen 1×）：2026-10-05 到 10-12 的 629 次 ci-gate 里有 146 次（23%）被同一 ref 的下一次 push 取消。
- 验证：`sh -n tooling/scripts/nightly-retro.sh` 通过，`--dry-run` 打印出提示词与窗口；首次实跑结果见 PR。无产品代码改动，ci-gate 只跑路径检测。
- 候选/发布：仅源码，无新候选。
