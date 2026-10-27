## 2026-10-27 · 开放注册：新账户不带套餐，默认关闭
- Status: provisional
- Chosen: 控制面新增 `PUBLIC_SIGNUP`（`"true"` 才开，`wrangler.jsonc` 里为 `"false"`）。开启后，未受邀、未注册的邮箱也能收到验证码；验证成功（邮箱验证码或 Apple/Google OIDC）即创建账户，但 `expires_at = created_at`，`plan` 为空，即「从未有过套餐」。登录、`auth/refresh`、带 token 的接口返回 403 `ENTITLEMENT_REQUIRED`（"Your Tono account is ready but has no active plan yet"），不签发 token、不登记设备、不进出口 roster。运维在客户详情设置到期时间后才能正常登录。已受邀的邮箱（`signup_allowlist` 或 `DIRECT_SIGNUP_ALLOWLIST`）不变，仍带入运维 onboard 时的资料、到期和套餐。`GET /api/v1/auth/methods` 增加 `email.publicSignup`，只说明全局开关，不涉及具体邮箱。`auth/email/start` 仍对所有邮箱返回同一个 202。对「既无账户也无邀请」的邮箱，每天最多发 `PUBLIC_SIGNUP_CODES_PER_DAY` 封（默认 200）。超出后静默不发信，不返回 429，因为 429 会暴露该邮箱没有账户。已有账户不占这个额度。
- Rejected: 给开放注册的新用户免费试用、免费流量或无限期套餐。免费额度、试用时长、付费渠道和订阅都由负责人决定，本决定不选。也没有采用「先签发会话、在各接口里再挡」的做法：那样要改 `auth()`、目录和凭据各条路径，而 `expires_at = created_at` 让现有每道套餐闸门（登录、会话、目录、出口 roster 的 SQL、`ineligible`）原样拒绝服务。
- Why stricter: 默认关闭；开启后也不发放任何权益，不改变防枚举的 202、按 IP 和按邮箱的限流、中继聚合桶、验证码尝试次数和 Google 非权威邮箱规则。新增的是一个全局每日发信上限。用户被停用的处理不变。
- Applied in: `feat/control-plane-public-signup`（`services/control-plane/src/{accounts,signup-profile,login,env,index}.ts`）；错误码见 [control-plane-error-contract](../control-plane-error-contract.md)。

2026-10-27 续（`feat/public-signup-honest-delivery`）：在不泄露单个邮箱状态的前提下，让客户端提示与实际情况一致。只公开全局状态：`email.publicSignup` 改为「开关已开，且当天给新邮箱发码的额度还没用完」；`auth/email/start` 的 202 也带同一个值，在本次请求处理完后计算，所以无论邮箱是否存在，同一时刻读到的都一样。新增 `email.deliveryDegraded`：邮件服务商最近 15 分钟内在服务端出过错（401/403/429/5xx 或网络异常），而且之后还没有成功送达过。400、422 这类针对单个收件人的拒绝不计入，否则攻击者可以借它判断某个地址有没有账户。没有采用按 challenge 查询发送状态的接口：在邀请制下，「没发」本身就说明该邮箱没有资格。
