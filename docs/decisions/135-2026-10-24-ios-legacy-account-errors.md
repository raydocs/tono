## 2026-10-24 · 决策 135 · iOS 账户拒绝遵循 T8/T6 契约

- Status: provisional
- Chosen: 按编排者裁决，以已合 main 的决策134/T8契约为准；401 UNAUTHORIZED / INVALID_REFRESH_TOKEN 结束会话。只有明确账户状态码保留账户/配置，并撤销网络授权。
- Why stricter: 不把已撤销凭据继续当作会话有效；账户状态与认证失败分开；不让被拒绝身份的全流量隧道/On Demand持续拦截网络，不放宽TLS或账户隔离。
- Applied in: #1745 / fix/t2-ios-account
- 范围：iOS客户端，不修改T8契约或T6服务端。

### 当前决定

- `401 UNAUTHORIZED` / `INVALID_REFRESH_TOKEN` 是会话结束，沿原认证恢复流程（access拒绝可正常刷新一次，refresh拒绝/最终401则登出），由AppModel.signOut停止并移除配置。
- `ACCOUNT_EXPIRED` / `QUOTA_EXCEEDED`（历史别名`PLAN_EXPIRED` / `QUOTA_EXHAUSTED`）明确报告账户状态时，不登出、不清凭据、不删配置；兼容带这些明确code的401，不按message字符串猜测。
- 账户受限或明确`403 DEVICE_REAUTH_REQUIRED` / `USER_DISABLED`时，撤销连接意图，在生命周期锁内保存并读回On Demand=false，再请求NE停止。保留配置供续费/重新验证后用户恢复；不调用serviceClose，不记为core故障。
- 停止收据带`source=account`、`accountEpoch`、`at`。保存/读回失败仍请求停止并弹窗引导到系统VPN设置手动关闭，不声称已恢复网络。
- 真正凭据撤销返回401时走会话结束；`403 DEVICE_REAUTH_REQUIRED`是保留配置的明确账户状态，不与401混淆。

### 部署顺序与撤回的选项

必须先上线T6 #1738服务端，让套餐到期/超额返回403 ACCOUNT_EXPIRED / QUOTA_EXCEEDED，再交付依赖该区分的iOS账户体验。T6上线前，旧服务端对套餐到期返回401时，iOS仍会登出，与原有行为相同，不是本次回归。

此前本PR曾采用“来源不明401也保留配置”的provisional选项；编排者现已明确撤回，冲突回归已删除/收窄。原RED/GREEN历史只记录旧选项，不能作为当前401语义的验收。T8测试期望不修改；编号135保留，134属于T8。

### 验证边界

当前401契约RED：8fb4c8006 / run40086748254，152 tests / 3 failures，T8旧401会话结束探针失败。账户限制停隧道RED：b38ce2f7a / run40085931165，147 tests / 13 assertion failures；GREEN及准确head见PR验证评论。真机NE停止/On Demand持久化、配置保留、T1扩展归因集成和真实服务端联验仍需验证。
