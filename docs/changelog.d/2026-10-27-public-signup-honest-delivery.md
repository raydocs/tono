## 2026-10-27 · 开放注册：全局发信状态，供客户端如实提示
- 归属：ops 任务（控制面账户/登录），不属于 G1–G4 发布门；模块 `services/control-plane`。客户端改动另开 PR。
- 来源：origin/main `df0c0322a`（#1779 之后）→ 分支 `feat/public-signup-honest-delivery`；未合 main，未部署。
- 新增/优化：`GET auth/methods` 的 `email.publicSignup` 改为「开关已开，且当天新邮箱额度没用完」，并新增 `email.deliveryDegraded`（邮件服务商 15 分钟内出过服务端错误，且之后没有成功送达）。`auth/email/start` 的 202 带同一个 `publicSignup`。这些都是全局状态，不涉及单个邮箱。针对单个收件人的 400/422 拒绝不会触发 degraded。见[决策 138](../decisions/138-2026-10-27-public-signup-without-plan.md) 的续记。
- 缺陷修复：无（此前投递失败没有任何信号，额度用完时 `publicSignup` 仍显示 true）。
- 工程与测试：`worker-auth.test.ts` 新增 1 个 `it`（服务商故障与收件人拒绝），扩展额度用完的那个 `it`；`worker-harness` 的 `startEmailSignIn` 返回 payload；`auth/methods` 的期望增加 `deliveryDegraded`。
- 验证：见 PR 验证评论（vitest、typecheck，以及本地 `wrangler dev` 对真实 Resend API 的端到端运行）。
- 候选/发布：仅源码；生产 `PUBLIC_SIGNUP` 仍为关闭。
- 剩余限制：没有在生产用真实收件箱完成过端到端（需要先打开开关，或使用负责人的 Resend 测试地址）。
