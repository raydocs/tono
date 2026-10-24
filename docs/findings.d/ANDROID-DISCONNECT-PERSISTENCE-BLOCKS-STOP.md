| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-DISCONNECT-PERSISTENCE-BLOCKS-STOP | 持久化失败可阻止用户断开并保留隧道 | in-PR | [#1742](https://github.com/raydocs/tono/pull/1742) | 高·已确认（JVM seam） | 真实断言 RED/GREEN；Android 集成构建、API29/30/34 与真机未验证，不声称设备上已复现 |

源码证据：`apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/TonoVpnService.kt:511-530；StopPersistence.kt:4-10`。
回归：`StopPersistenceTest.storageFailureCannotPreventPhysicalStopAndIsReportedAfterwards`。完整运行范围、原始日志和遗漏项见 [T3 验证记录](../agent-reports/2026-10-24-t3-android/README.md)。
