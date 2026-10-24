## 2026-10-24 · 套餐暂停不撤销账户会话，恢复仍须重新验证设备
- Status: provisional
- Chosen: 到期/超额仍撤销设备网络授权、清除 exit credential、保留 tailnet 撤权任务；新增 `devices.entitlement_suspended` 区分套餐暂停与显式撤权。该原因不撤销已有会话，access/refresh 返回 403 `ACCOUNT_EXPIRED` / `QUOTA_EXCEEDED`。续费后仍未重新授权的设备返回 401 `UNAUTHORIZED` / `INVALID_REFRESH_TOKEN`，重新验证登录才清除此标记并恢复授权。不自动恢复旧网络身份；不复活过去已撤销的会话。
- Why stricter: 不放宽出口 roster、TLS、账户/设备隔离或会话插入触发器。显式撤权、停用账户、会话过期仍拒绝认证；旧客户端至少不再因套餐问题收到 401。
- Applied in: `fix/t6-control-plane`；错误码契约 [control-plane-error-contract](../control-plane-error-contract.md)。

旧的 `worker-roster-quota.test.ts:182,231` 明确断言套餐/续费后的旧 refresh 返回 401，与本任务的“不得登出”要求冲突。本线程遵守“不改既有测试期望”，保留失败并交由编排者协调，不以特殊客户端版本、测试分支或状态码伪装绕过它们。

2026-10-24 CI续修：上段描述的是历史head的阻塞。用户随后要求修复CI；本轮按已要求的账户契约同步集成用例，并增加精确error.code、会话保留、device/credential撤销、roster排除和新验证前后授权检查。不是把安全拒绝改成放行；生产授权逻辑未改。旧失败run及新旧源码RED/GREEN见验证记录。

Claude交叉审查续修：采用已发布桌面预留码ACCOUNT_EXPIRED/QUOTA_EXCEEDED；只有账户已恢复后才用401引导重新验证。重激活设备的同一batch原子撤销旧会话，后续登录失败不复活旧授权。原T0原600秒内多次恢复的有限竞争风险仍需编排者/owner显式接受，不能把provisional当owner批准。
