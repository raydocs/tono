| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-RECHECKING-DEMOTES-PHASE-BREAKS-UI | 重新探测将已确认隧道降为 Connecting，首页错误提供取消 | in-PR | fix/t3-android（PR 待开） | 高·已确认（JVM seam） | 真实断言 RED/GREEN；Android 集成构建、API29/30/34 与真机未验证，不声称设备上已复现 |

源码证据：`apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/TunnelAuthority.kt:91-93`。
回归：`TunnelAuthorityTest.recheckingDoesNotTurnAWorkingTunnelIntoACancellableConnectionAttempt`。完整运行范围、原始日志和遗漏项见 [T3 验证记录](../agent-reports/2026-10-24-t3-android/README.md)。
