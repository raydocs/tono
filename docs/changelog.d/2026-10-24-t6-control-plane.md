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

### 2026-10-24 CI 续修 · 集成契约同步
- 定位 run40082806706：三条已记录旧契约断言导致control-plane失败，ci-gate连带失败，非基础设施故障；不对旧run做无效重跑。
- 仅改两份集成测试，按已要求的403账户状态/原窗口多次恢复契约同步，同时补强credential撤销、roster排除、仅一live session、旧token拒绝及正常轮换/过期边界。生产安全逻辑、测试门槛和超时均不变。
- 新契约对原322f的auth/sessions/devices源码真实RED三项；恢复当前实现窄回归49 passed。历史失败证据保留；最新完整结果及普通push见验证续记，无合并/部署。
- 本轮最终本地：70文件/1072测试全部通过，覆盖率门槛通过；typecheck及diff检查通过。本轮无生产src改动；新head远端CI尚待完成，不沿用失败run为通过证据。

### 2026-10-24 Claude 阻塞项与两项建议续修
- 06a5408c2：采用已发布桌面预留403 ACCOUNT_EXPIRED/QUOTA_EXCEEDED；仅账户已恢复但旧设备仍撤权时，标准401进入重新登录，不等待客户端新版。错误表同步并通知T2/T3。
- 同时修复公开中继无聚合cap（共用200次/900秒、subject限制不变）及重激活设备后token失败复活旧session（同batch先撤会话再改设备，两种激活分支/事务失败回滚均有回归）。无新增migration、feed、签名或部署脚本改动。
- RED49bd0fc91：6 failed/4 passed（三个兼容契约、一个relay聚合cap、两个重激活分支）；当前三文件11 passed，扩大8文件62 passed，补充事务回滚6 passed；typecheck通过。完整重跑见验证续记。
- 原T0在原600秒内多次恢复的有限竞争风险未改；编排者/owner显式接受仍待确认，不能据先前审查或provisional决定推定已批准。未合并/部署。
- 最终续验：06a5408c2全量73文件/1084测试通过，coverage门槛与typecheck通过；新delta尚未独立复审，远端CI待新head执行。只补文档后普通push，不force-push、不合并/auto-merge/部署。
