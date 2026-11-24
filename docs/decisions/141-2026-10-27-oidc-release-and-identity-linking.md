## 2026-10-27 · Apple / Google 登录进正式版：只信提供商自己托管的邮箱，其余经邮箱验证码关联
- Status: provisional
- Chosen: 用户已决定正式版支持 Apple 和 Google 登录。控制面 `APPLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` 改为可写逗号分隔的多个 client ID（第一个为主），每个平台（App bundle ID、Apple Web Services ID、Google 桌面 / iOS / Android client）用自己的 audience；`auth/oidc/challenge` 可带 `clientId`，只回显已配置的值。提供商的 `email` 只有在提供商本身托管该邮箱时才用来选中或创建账户：Google 为 Gmail，或 Workspace `hd` 等于邮箱域名（决策 072）；Apple 为 `icloud.com`、`me.com`、`mac.com` 和隐藏邮箱 `privaterelay.appleid.com`。其他邮箱（例如 Apple ID 绑定的 Outlook 地址）返回 401 `EMAIL_OWNERSHIP_UNVERIFIED`，并附 10 分钟的 `linkTicket`（HMAC 签名，绑定提供商、subject、提供商给的邮箱和 installation）。用户在同一 installation 用该邮箱的验证码登录时带上票据，才把该提供商身份关联到这个账户。已关联到别处的提供商账户、或账户已有另一个同提供商身份，都不移动、不替换，返回 `conflict`。只有登录本身完成（签发了会话）后才兑现票据；验证码之后被拒（无套餐、设备数满、注册冷却）时不关联。
- 客户端约定（共享设备）：票据只存在内存里，不落盘。客户端发 `linkTicket` 前必须明确询问「把 Apple ID / Google 账号（打码邮箱）关联到这个 Tono 账户？」，用户同意才发；用户取消、改输入的邮箱、切换或退出账户、或超过 10 分钟时丢弃票据。否则同一台设备上，A 先用一个绑定了已转手邮箱的 Apple ID 尝试登录，邮箱现主人 B 随后在 10 分钟内用验证码登录，A 的 Apple ID 就会关联到 B 的账户。
- Rejected: 凭提供商声称已验证的邮箱自动合并账户（邮箱可能已转手，旧 Apple/Google 账户仍声称已验证）；Apple 对任意域名都算权威（此前的行为，Apple 对第三方邮箱只做过一次验证）；以邮箱字符串匹配隐藏邮箱与真实邮箱（Apple 不提供二者关系，不同 Tono 账户只能各自存在，需要合并时由用户用验证码关联，或运维处理）。
- Why stricter: 收紧了 Apple 原先的自动关联；新的关联路径要求同时证明提供商账户和邮箱，并且只能在发起的那台设备上完成。无套餐用户的处理不变（决策 138）：关联可以完成，但登录仍是 403 `ENTITLEMENT_REQUIRED`。开放注册开关、权益和支付渠道都不在此决定。
- 变更影响: 已部署的 Apple 关联若来自第三方邮箱，已有的 `auth_identities` 行继续有效（按 subject 登录），只影响新的关联。
- Review: 独立安全审查（2026-10-27）未发现接管路径；按其意见改为登录完成后再兑现、补充上面的客户端约定和冲突/过期/被拒的测试。
- Applied in: `feat/oidc-sign-in-release`（`services/control-plane/src/{oidc,oidc-routes,accounts,login,index}.ts`）。客户端（macOS 去掉 `#if DEBUG`、Windows、iOS）在后续 PR；需要负责人提供 Apple Services ID / Sign in with Apple key、各平台 Google client ID，以及 App Review 与真机验证。
