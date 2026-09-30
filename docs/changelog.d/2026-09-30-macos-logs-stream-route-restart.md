## 2026-09-30 · 住宅路由上下文切换时一并重建日志流
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1，macOS 审计流（CoreWebSocket / LocalTrafficAudit）。
- 来源：main `01c2403f` → 分支 `glm/mac-logs-route-restart`；PR 待开；未合 main。
- 缺陷修复：`commitResidentialRouteAuditContext` 此前只重启连接流，logs 流保留旧 runtime 的 250 ms 合并缓冲与在途回调；`recordCoreLogs` 无代际护栏（连接流的 `residentialContext == residentialRouteContext` 校验只覆盖 `recordConnections`），旧路由行在提交后被刷新并按新的 assistant 直连首选成员分类，路由切换后可产生假 `managed_direct_group_failed_over` 审计事件。现在同一提交点追加 `restartLogsStreamAfterRuntimeChange()`（镜像连接流的重启）：仅当 logs 流开启时丢弃缓冲行与在途回调、按原 level 重建；关闭的流保持关闭。关联 [MAC-LOGS-STREAM-ROUTE-CONTEXT](../findings.d/MAC-LOGS-STREAM-ROUTE-CONTEXT.md)。
- 新增/优化：无；不改变日志分级、logs 开关判定与断开/重连行为。
- 工程与测试：新增 `TonoTests/CoreWebSocketLogsRestartTests`（确定性，按所有者复核要求重做）：`enqueueLog` 去掉 `private` 供测试直接注入合并缓冲（其余可见性不变），闭合端口 9 上无任何网络 fixture；同一 MainActor 回合内先注入旧 runtime 行再重启，断言该行不再经 `onLogs` 送达（250 ms 刷新任务从未获得执行机会），随后 `stopLogsStream` 后重启仍保持关闭、后续注入不送达。
- 验证：本机为 Linux 工作树，无 Xcode/Swift 工具链，XCTest 未运行（hosted CI 执行）；仅静态核对新方法与 `restartConnectionsStreamAfterRuntimeChange` 的对称性及既有测试风格。`git diff --check` 通过（exit 0）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：假 `managed_direct_group_failed_over` 为推导，未在实机审计日志中回溯确认；测试不建立真实连接，旧任务在途回调的丢弃由 `receiveLogs` 的任务同一性护栏保证（与连接流同一机制），未在测试中覆盖。
