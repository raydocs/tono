# 控制面账户与重试错误契约（T6，2026-10-24）

本契约供 T2（iOS）、T3（Android）、T4（macOS）、T5（Windows）接入。
响应保持已有 envelope：`{"error":{"code":"PLAN_EXPIRED","message":"…"}}`。
不需要版本/header 协商：旧客户端也必须停止收到把套餐状态误作凭据失效的 401。

| HTTP | error.code | 含义 / 客户端动作 |
|---|---|---|
| 403 | PLAN_EXPIRED | 套餐到期；保留账户、令牌、VPN 配置，显示“套餐已到期，请续费或联系家人” |
| 403 | QUOTA_EXHAUSTED | 额度用完；保留账户、令牌、VPN 配置，显示“流量已用完，请续费或联系家人” |
| 403 | DEVICE_REAUTH_REQUIRED | 套餐恢复，但旧网络授权已撤销；保留账户/配置，提示重新验证登录以恢复此设备，不自动连接 |
| 403 | USER_DISABLED | 验证登录后账户被停用；拒绝授权，不等于套餐到期。已撤销的旧会话仍为 401 |
| 401 | UNAUTHORIZED / INVALID_REFRESH_TOKEN | 凭据失效、过期、主动撤销或设备撤权；沿用认证恢复流程 |
| 429 | RATE_LIMITED | 不登出、不删除报告；保留待发数据，按 `Retry-After`（整数秒）等待后重试 |

优先级：凭据/账户停用/显式设备撤权先拒绝；有效身份的套餐到期先于额度用完。
到期/超额的网络撤权仍照常执行；标记该原因并保留会话行（不是继续提供 VPN 服务）。
续费不自动复活网络凭据，保持既有“重新验证后恢复”策略。
登录 start 不透露账户存在性，仍返回统一 202；已验证邮箱/OIDC 后才返回具体账户错误。
刷新遇到账户状态返回 403，不消费 refresh token。

P0（服务端 allowlist 中的网络丢失 code）与普通 FAILURE 使用不同账户限流桶。
调用者自报 `p0` 标志不提供豁免；P0 仍有限额，完整 payload 仍验证后才写入。

旧客户端兼容限制：403 不触发原有 401 登出，但人话和恢复按钮需要各客户端接入；服务端不代替客户端显示验收。
T4 负责 macOS telemetry outbox 遇 429 保留；T5 负责 Windows 同类处理。

中继登录：只认 Cloudflare 覆写的 `CF-Connecting-IP` 与编译的 API_RELAYS 精确匹配；不认客户端自报转发头，不按 ASN 放行。中继邮件请求保留跨设备全局邮箱上限（比邮箱+设备组合更严格）；验证保留 challenge 上限，OIDC start 保留 installation 上限。直连仍额外按 IP。

默认桶额度：自动 DIAGNOSTICS 12/h、60/day；P0 24/h、120/day；原 FAILURE 12/h、60/day 不变。
配置名分别是 `RATE_LIMIT_AUTOMATIC_DIAGNOSTICS_USER_HOUR/DAY`、`RATE_LIMIT_PZERO_USER_HOUR/DAY`。
