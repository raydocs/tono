## 2026-10-24 · 决策 135 · iOS：旧账户错误不推断为退出登录

- Status: provisional
- Chosen: 保留歧义旧401的本地凭据和VPN配置，拒绝自动推断登出。
- Why stricter: 不绕过服务端授权，不误删套餐用户配置，不放宽TLS或账户隔离。
- Applied in: #1745 / fix/t2-ios-account / 50b332d61
- 日期：2026-10-24
- 范围：T2 iOS 账户错误兼容；不改变服务端授权、隧道保护或凭据权限。

### 证据

基线 `322f48c6f` 的 `services/control-plane/src/auth.ts:37-47` 将套餐到期、额度耗尽与失效会话都报告为 `401 UNAUTHORIZED`；`services/control-plane/src/sessions.ts:104-115` 将同类账户限制与无效刷新凭据都报告为 `401 INVALID_REFRESH_TOKEN`。客户端不能从这两个旧码可靠判断是否应删除 VPN 配置，不能按消息字符串猜测。

### 决定

- 新合同 `403 PLAN_EXPIRED` / `QUOTA_EXHAUSTED` 和同码旧 `401` 是账户限制，不是会话结束；不刷新为登出、不使用缓存绕过拒绝，显示续费/联系家人的说明。
- 旧 `UNAUTHORIZED` 仍可尝试一次正常刷新；若仍被拒绝，保留本地凭据和 VPN 配置，显示“检查账户或套餐”，不声称账户有效或连接成功。旧 `INVALID_REFRESH_TOKEN` 同样保留并提示，不继续刷新。
- 明确 `SIGNED_OUT` / `ACCOUNT_SUSPENDED` 仍可结束本地会话；用户主动退出始终清理凭据和配置。
- 保留的凭据不能绕过服务端校验；不恢复被拒绝的请求、不改账户隔离、不放宽 TLS。旧服务器下真实失效凭据也可能被保留，用户需在设置中重新登录，这是不误删套餐用户配置的兼容代价。

### 验证边界

`AccountRestrictionTests` 覆盖错误分类、401 套餐不刷新、403 配额不回退缓存。真实旧/新服务端和真机 Network Extension 配置保留仍须联验；这不是客户发布批准。
