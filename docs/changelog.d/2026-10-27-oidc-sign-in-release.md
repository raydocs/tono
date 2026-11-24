## 2026-10-27 · 控制面：Apple / Google 登录的正式版后端（多平台 client、邮箱权威、经验证码关联）
- 归属：用户决定（正式版支持 Apple 和 Google 登录）；SHIP_PLAN 之外的账户功能，决策 141。
- 来源：origin/main → 分支 `feat/oidc-sign-in-release`；未部署，生产 buildSha 未变。
- 新增/优化：`APPLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` 可配多个 client；`auth/oidc/challenge` 接受 `clientId`。Apple 只对 iCloud 与隐藏邮箱作保，其他邮箱与 Google 非权威邮箱一样返回 `EMAIL_OWNERSHIP_UNVERIFIED` 并附 `linkTicket`；`auth/email/verify` 接受 `linkTicket`，成功时返回 `identityLink`。OIDC 路由移到 `src/oidc-routes.ts`（`index.ts` 减少约 100 行）。
- 工程与测试：`worker-auth.test.ts` 新增关联票据（他机、他人账户不能兑现；同机同邮箱可关联且随后 Apple 登录到同一账户）和多 client 两个用例，旧 Apple 关联用例改写。
- 验证：见 PR 验证评论。
- 剩余限制：生产 `GOOGLE_CLIENT_ID` 为空；客户端尚未接入；需要负责人提供 OAuth 配置、审核与真机验证。

2026-10-27 续（独立安全审查）：票据改为登录完成后才兑现（验证码之后被拒，例如设备数满或注册冷却，不再留下关联）；决策改为 141（140 已被 #1792 使用）；决策和错误契约写明客户端在发送票据前必须明确确认、只放内存。新增冲突、超时和被拒三种情况的测试。
