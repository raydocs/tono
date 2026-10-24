| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MOBILE-ENTITLEMENT-401-SIGNS-OUT | 套餐到期/超额被当成凭据失效返回 401，移动端登出并删 VPN 配置 | in-PR | 本 PR · fix/t6-control-plane | 高·已确认（本地 D1 回归） | 服务端改为 403 并区分网络撤权；T2/T3 客户端人话/按钮及真机未验；CI续修已将两条集成用例同步为精确403与网络撤权/会话检查，最新CI待验 |

证据：基线 `322f48c6f` 的 `src/auth.ts:39-47`、`src/sessions.ts:106-115` 把 entitlement 合并到认证失败；仅改这两处还会被 `enforceUser` 撤销会话。
修复：`services/control-plane/src/accounts.ts:16`、`auth.ts:48`、`sessions.ts:116`；`devices.ts:360,385` 保留套餐暂停会话但撤销网络身份。迁移 0104 默认不复活旧身份。
RED：`336a2fa59` 两项失败（401 ≠ 403）；GREEN：`d2d512985` 三项通过；完整证据见 [验证记录](../reports/t6-control-plane-verification-2026-10-24.md)。

2026-10-24 CI续修：run40082806706 的旧规范断言已同步到用户要求的契约；生产代码及安全边界未改，旧源码三项真实RED、当前窄49项GREEN见验证记录；先前失败记录仍为历史事实。
