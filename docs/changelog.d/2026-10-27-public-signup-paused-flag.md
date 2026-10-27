## 2026-10-27 · 开放注册：把「当日名额已满」和「邀请制」分开
- 归属：ops 任务（开放注册，决策 138）；`services/control-plane`。
- 来源：origin/main（#1781 之后）→ 分支 `fix/public-signup-paused-flag`；未部署。
- 缺陷修复：在 #1781 中，当日新邮箱额度用完后 `email.publicSignup` 也变成 false，客户端没法区分「暂停」和「邀请制」，Windows 的提示会写成「Tono 目前只对受邀用户开放」。现在 `publicSignup` 只表示注册模式，新增 `signupPaused` 表示额度已满；`auth/methods` 和 start 202 都带这两项，且都是全局状态。
- 工程与测试：扩展 `worker-auth.test.ts` 中额度用完的 `it`，以及开放注册那个 `it`；`auth/methods` 的期望增加 `signupPaused`。
- 验证：见 PR 验证评论。
- 剩余限制：客户端文案在 #1783（macOS/iOS）和 #1778（Windows）里跟进。生产开关未开。
