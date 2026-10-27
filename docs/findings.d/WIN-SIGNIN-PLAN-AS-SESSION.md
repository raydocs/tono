| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SIGNIN-PLAN-AS-SESSION | Windows 套餐到期或流量用完时，已登录设备显示「登录已失效」，重新登录时显示「登录服务暂时不可用」：403 `ACCOUNT_EXPIRED`/`QUOTA_EXCEEDED`（及新账户 `ENTITLEMENT_REQUIRED`）落进通用 `ApiError::Forbidden` → `TONO_AUTH_FORBIDDEN` → serverError | in-PR | 待开（叠在 #1777 上） | 中·已确认（代码阅读 auth.rs map_status、services/tono.ts STABLE_ERROR_KEYS；vitest RED） | 已登录设备侧依据缓存账户的 `expiresAt`/用量推断，缓存过旧时退回通用「登录已失效」；会话被拒的服务端码仍不送前端；Rust 未本地编译（CI 编译）；待实机 |
