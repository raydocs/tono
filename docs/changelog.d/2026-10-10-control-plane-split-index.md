## 2026-10-10 · 控制面 index.ts 拆出请求处理的辅助函数（A23）
- 归属：ops 任务，[运维计划](../ops/plan-2026-09-11.md)；Amp 待办 [A23](../ops/amp-backlog-2026-10-10.md)（D6-A，一个文件一个 PR）；影响 `services/control-plane`。
- 来源：基线 `origin/main` 681f1e6f → 分支 `amp/a23-split-index`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：无行为变化。index.ts 第 101–1902 行的顶层辅助函数按主题原样移到六个新模块：`client-reports`（路由研究快照、
  设备动作结果的规范化与受保护路由证明）、`exit-credentials`（出口凭据名册与标签、`sha256Hex`）、`tailscale`（OAuth、API 调用、
  按清单解析设备、`sameAddressSet`）、`devices`（待定过期、登录建设备、吊销、吊销队列、按用户执法）、`enrollment`（签发注册密钥、
  确认状态机）、`login`（限流、邮件/OIDC 挑战参数、邮件验证码投递、登录结果）。函数体逐字不变；只加了 `export` 与各文件的
  import。新模块之间是单向依赖（login → enrollment → devices → tailscale），都不反向 import index.ts，所以不需要 deps 对象。
  `route`、`operationsAdmin`、`buildSha` 与默认导出留在 index.ts；Worker 的导出、路由与 wrangler 配置不变。`scheduled.ts`
  仍经 `ScheduledDeps` 收这些函数，只改了一行注释说明它们的新位置。
- 工程与测试：`test/index-size.txt` 由 3483 降到 1724（index.ts 新行数）；`docs/architecture.md` 的已拆出清单加上六个模块。
- 验证：Linux orb，Node 24。拆前拆后各跑一次 `npm test`，文件数与用例数相同；`npm run typecheck` 通过（noUncheckedIndexedAccess
  错误去掉位置后逐条相同，520 条）；`check:budgets`、`check:contract` 通过；`wrangler deploy --dry-run` 打包成功（未部署）。
  移动代码的规范化行多重集与原 index.ts 相同，各模块内行序与原行区间一致（脚本见 PR 描述）。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：`route` 本身（约 1500 行的单个函数）未拆；拆它要改控制流结构，不属于纯移动。
