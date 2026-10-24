## 2026-10-24 · T6 账户状态契约、中继登录与 P0 告警限流
- 归属：SHIP_PLAN §2 item 10「连不上且无下一手」控制面修复；不推进客户发布门。
- 来源：`322f48c6f` → 实现/测试 `ef49c5560`；分支 `fix/t6-control-plane`，本 PR；未合 main。
- 缺陷修复：套餐到期/超额返回明确 403，不消费 refresh、不过期撤销会话；仍撤销网络身份，续费须重新验证。精确已知 relay 源不再共用登录 IP 桶，邮箱/challenge/installation 与直连 IP 上限不变。P0、自动 diagnostics、FAILURE 分桶，429 返回剩余窗口 Retry-After。
- 新增/优化：[账户错误码表](../control-plane-error-contract.md)、provisional [决定 133](../decisions/133-2026-10-24-account-entitlement-suspension.md)；migration 0104 仅新增暂停标记列，不复活旧会话。
- 工程与测试：新增真实 RED/GREEN 回归，显式撤权、续费重新验证、伪造转发头与 Retry-After 精确秒数均覆盖；没有改既有测试期望。
- 验证：Mac 本地四文件 12 passed，typecheck 通过，migration additive 静态检查通过。完整测试 1065 passed / 2 failed，保留两条旧 401 契约失败，不是全绿；详见[验证记录](../reports/t6-control-plane-verification-2026-10-24.md)。
- 候选/发布：仅源码，无新包、未部署、无生产迁移；feed/签名/部署脚本/客户源未动。
- 剩余限制：旧测试规范冲突需编排者协调；Claude 交叉审查、CI、移动端 UI/配置保留、真实中继/邮件、macOS/Windows 429 outbox 和真机未验证。macOS 客户端留 T4、Windows 留 T5；P2 可选项未扩围。

### 2026-10-24 续记 · WORKER-REFRESH-SECOND-REPLAY
- 同 PR #1738 追加：`162f96549` 让原refresh root在D1原子轮换中重指向本次恢复successor，连续丢失刷新响应仍可在原600秒内恢复；不延长窗口，不授予中间token宽限，正常轮换/退出/撤权不复活。
- RED：纠正新logout测试fixture后的 `f1da98c94` 测试配原429e23427源码，3 failed/2 passed；GREEN新回归5 passed，含冻结时钟截止与受控并发。typecheck通过。详情/有限重放竞争风险见[验证续记](../reports/t6-control-plane-verification-2026-10-24.md#追加-worker-refresh-second-replay)。
- 原one-replay测试明确要求第二次401，与追加需求相反，未改期望；扩大回归43 passed/1 failed，不是全绿。独立安全/Claude审查和真实连续响应丢失链路未验；无新migration、无新包、未合并/部署。
- 最终续验：五文件17 passed；完整suite为1069 passed/3 failed（70文件），三条均为上述未改动旧规范冲突，不是全绿。只补交付文档后推送同一PR。
