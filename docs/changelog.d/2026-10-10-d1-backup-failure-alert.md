## 2026-10-10 · 控制面 D1 夜间备份失败告警
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；backlog [A14](../ops/amp-backlog-2026-10-10.md)（#208，依赖 D16）；
  `.github/workflows/control-plane-d1-backup.yml`。
- 来源：基线 main 4e373f06 → 分支 `amp/a14-d1-backup-alert`；PR 见分支；未合 main。
- 缺陷修复：原行为：备份每晚在「Require Cloudflare credentials」失败（例如 run 37917885322），只有一个红色运行，无人被告知。
  改后：新 `alert` job（`needs: backup`、`if: always()`，job 级 `issues: write`，不用 Cloudflare 密钥、不 checkout、无 artifact）
  在备份不成功时开一个 `d1-backup-failure` issue 或在已开的那个上评论，下一次成功时评论并关闭。#208 仍 open。
- 新增/优化：[d1-backups.md](../ops/d1-backups.md) 写明告警行为和所有者仍需做的凭据步骤（D1 Edit + Workers R2 Storage Edit token、
  Account ID、`gh secret set`、手动跑一次）。备份 job 权限与 dump 不出 Cloudflare 的性质不变。
- 工程与测试：新增 `tooling/scripts/tests/control-plane-d1-backup-workflow.test.mjs`（一个 test：权限范围、无 artifact、
  stub `gh` 跑失败路径得到 label create → issue list → issue create）。本地 Node 24 通过；actionlint 未安装，未跑；
  未 dispatch 备份工作流，告警 job 的真实 GitHub 运行要等下一次 nightly。
- 候选/发布：无包、无部署。
- 剩余限制：**A14 的实际备份仍阻塞在 D16**：仓库密钥 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 只能由所有者提供；
  在那之前 nightly 仍失败，只是现在会告警。R2 `backups/` 90 天生命周期规则仍需控制台设置。
