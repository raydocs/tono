# 控制面账户与重试错误契约（T6，2026-10-24）

本契约供 T2（iOS）、T3（Android）、T4（macOS）、T5（Windows）接入。
响应保持已有 envelope：`{"error":{"code":"ACCOUNT_EXPIRED","message":"…"}}`。
不需要版本/header 协商：旧客户端也必须停止收到把套餐状态误作凭据失效的 401。

| HTTP | error.code | 含义 / 客户端动作 |
|---|---|---|
| 403 | ACCOUNT_EXPIRED | 套餐到期；保留账户、令牌、VPN 配置，显示“套餐已到期，请续费或联系家人” |
| 403 | QUOTA_EXCEEDED | 额度用完；保留账户、令牌、VPN 配置，显示“流量已用完，请续费或联系家人” |
| 401 | UNAUTHORIZED（access）/ INVALID_REFRESH_TOKEN（refresh） | 账户已恢复，但旧设备网络授权仍已撤销；进入已发布桌面客户端的重新登录流程，不自动恢复网络身份。移动端可保留配置并提供重新登录动作 |
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

兼容基线：`ACCOUNT_EXPIRED` / `QUOTA_EXCEEDED` 已存在于 macOS `TonoAPIClient.entitlementCodes` 与 Windows `ENTITLEMENT_CODES`，不等待新桌面版本。仅在账户已经恢复、设备授权仍被撤销时返回401，套餐仍失效时绝不以401代替403。移动端应兼容这两个既有码（可以保留 PLAN_EXPIRED / QUOTA_EXHAUSTED 为历史别名），人话/按钮仍须客户端验证；服务端不代替客户端显示验收。
T4 负责 macOS telemetry outbox 遇 429 保留；T5 负责 Windows 同类处理。

中继登录：只认 Cloudflare 覆写的 `CF-Connecting-IP` 与编译的 API_RELAYS 精确匹配；不认客户端自报转发头，不按 ASN 放行。中继邮件请求保留跨设备全局邮箱上限（比邮箱+设备组合更严格）；验证保留 challenge 上限，OIDC start 保留 installation 上限。直连仍额外按 IP。

默认桶额度：自动 DIAGNOSTICS 12/h、60/day；P0 24/h、120/day；原 FAILURE 12/h、60/day 不变。
配置名分别是 `RATE_LIMIT_AUTOMATIC_DIAGNOSTICS_USER_HOUR/DAY`、`RATE_LIMIT_PZERO_USER_HOUR/DAY`。

Claude审查84e567140后的修订：此前文档中的 PLAN_EXPIRED / QUOTA_EXHAUSTED / 403 DEVICE_REAUTH_REQUIRED 不再作为本PR的服务端输出；以本表为准。原审查/RED记录不改写。
中继还共享每源IP、所有登录kind合计200次/900秒的聚合桶（`RATE_LIMIT_RELAY_AUTH_IP`，窗口沿用 `RATE_LIMIT_WINDOW_SECONDS`），对公开中继上的D1写入设上限；邮箱/challenge/installation各自上限继续生效，429带Retry-After。
重新激活暂停设备时，在同一D1 batch内先撤销该设备旧会话再更新设备状态；后续recording/enrollment/tokens失败也不能复活旧token。batch本身失败时设备/会话一同回滚且仍无网络授权。
