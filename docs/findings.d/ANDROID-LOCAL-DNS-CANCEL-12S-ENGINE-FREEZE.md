| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-LOCAL-DNS-CANCEL-12S-ENGINE-FREEZE | 本地 DNS 取消不释放同步等待，迟到回调也可能重复完成 | in-PR | [#1742](https://github.com/raydocs/tono/pull/1742) | 高·已确认（JVM seam） | 真实断言 RED/GREEN；Android 集成构建、API29/30/34 与真机未验证，不声称设备上已复现 |

源码证据：`apps/android/mobile/src/main/kotlin/com/raydocs/tono/mobile/engine/BoxPlatform.kt:224-243；DnsCompletion.kt:9-28`。
回归：`DnsCompletionTest.cancellationReleasesTheEngineWaitAndRejectsLateCallbacks`。完整运行范围、原始日志和遗漏项见 [T3 验证记录](../agent-reports/2026-10-24-t3-android/README.md)。

审查续核：pin 25b0d5ea 的 experimental/libbox/dns.go:114-130 在 Go goroutine 调用 raw Exchange，外层 select 响应取消；所以不据 JVM seam 宣称串行 tono-engine 冻结 12s。实际修复范围为取消释放 exchange 等待及拒绝迟到 ctx 完成。
