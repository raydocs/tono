## 2026-10-10 · 仓库卫生：按「已合并 + 工作树干净」清理远端分支与本地 worktree
- 归属：ops（[运维计划](../ops/plan-2026-09-11.md)），[Amp 待办](../ops/amp-backlog-2026-10-10.md) A26，D10 选 A（自动删）；仓库工具，不进任何包。
- 来源：基线 main `4e373f06` → 分支 `amp/a26-prune-merged-branches`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：`tooling/scripts/prune-merged-branches.mjs`。`remote`：列出 origin 上 tip 是 origin/main 祖先、或是已合并
  同仓 PR 的 head 且每个补丁都在 main 上（`git cherry` 无 `+`）的分支；保留 `main`、`release/*`、`stability/*`
  （`macos-release.yml` 的 `CANDIDATE_REF` 指向它）、`gh-readonly-queue/*`、main 的 `.github/workflows` 里点名的分支、
  任何开着的 PR 的 head 与 base（删 base 会关掉叠放 PR）、tip 等于 main 的新分支、以及有 main 之外提交的分支。
  删除用 `--force-with-lease=<ref>:<列出时的 SHA>`，列出后被推过的分支不删。读不到开着的 PR 列表就不删。
  `worktrees`：只移除分支 tip 在 main 上、工作树干净（无修改、暂存、未跟踪文件）的链接 worktree；不碰主 worktree、
  当前 worktree、locked、目录缺失、detached、tip 等于 main、以及 24 小时内动过（HEAD/index/reflog mtime，
  `--min-idle-hours`）的 worktree；`git worktree remove` 不带 `--force`。两种模式默认 dry-run，`--apply` 才动手。
  `.github/workflows/prune-merged-branches.yml`：每周一 04:41 UTC 以 `--apply` 跑 remote 部分；手动触发默认 dry-run；
  权限 `contents: write`（唯一写权限）+ `pull-requests: read`。AGENTS.md「Records and Git」加两行规则。
  仓库设置「Automatically delete head branches」目前已开（`gh repo view --json deleteBranchOnMerge` 为 true），
  属所有者设置，本 PR 不改，建议保持开启。
- 工程与测试：`tooling/scripts/tests/prune-merged-branches.test.mjs` 三条（远端选择、`--apply` 租约、worktree 选择），
  用临时裸仓库；`services-ci.yml` push 路径加入脚本本身。
- 验证：见 PR 正文（Linux orb，Node 24，`node --test`；对真实 origin 只跑 dry-run）。
- 候选/发布：无新包。
- 剩余限制：未对真实 origin 跑 `--apply`（合并后由每周工作流或维护者执行）；maintainer Mac 上的 worktree 清理需在那台机器上
  手动跑 `worktrees` 模式；squash 合并的分支（补丁不逐一在 main 上）不会被选中，需人工处理。
