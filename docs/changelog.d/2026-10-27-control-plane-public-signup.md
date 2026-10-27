## 2026-10-27 · 控制面开放注册开关（新账户不带套餐，默认关闭）
- 归属：ops 任务（控制面账户/登录），不属于 G1–G4 发布门；模块 `services/control-plane`。客户端未改。登录页文案由 UI 线程（Windows `amp/windows-signin-honesty`）负责，已通知它服务端契约。
- 来源：基线 origin/main `316d06560` → 分支 `feat/control-plane-public-signup`；未合 main，未部署。
- 新增/优化：`PUBLIC_SIGNUP`（`wrangler.jsonc` 为 `"false"`）。开启后，任何邮箱验证成功都会创建账户，但账户没有套餐（`expires_at = created_at`）。登录返回 403 `ENTITLEMENT_REQUIRED`，不签发 token、不登记设备。运维设置到期时间后可正常登录。受邀邮箱行为不变。`auth/methods` 增加 `email.publicSignup`。发往陌生邮箱的验证码受全局每日上限 `PUBLIC_SIGNUP_CODES_PER_DAY`（默认 200）约束，超出后静默不发，起始接口仍对所有邮箱返回 202。见[决策 138](../decisions/138-2026-10-27-public-signup-without-plan.md)。
- 缺陷修复：无。
- 工程与测试：`test/worker-auth.test.ts` 新增 2 个 `it`；`worker-admin-routes.test.ts` 中 `auth/methods` 的期望增加 `publicSignup: false`。
- 验证：见 PR 验证评论（targeted vitest、全量 vitest、typecheck；红测：旧代码上 `auth/methods` 断言失败，单独去掉无套餐插入时注册返回 200 而不是 403）。
- 候选/发布：仅源码，无新候选；生产 `PUBLIC_SIGNUP` 仍为关闭。
- 剩余限制：开启前需要负责人决定新用户权益（无套餐 / 试用 / 免费档）和付费渠道。Windows 的 `ENTITLEMENT_REQUIRED` 文案在 #1778 中（「账号已建好，但还没有开通套餐」）。Windows 还没有读取 `email.publicSignup`，所以仍固定显示邀请制文案。macOS、iOS 和 Android 的文案还没有做。没有在生产用真实邮箱完成过开放注册。
