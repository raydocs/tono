| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-UNDERLYING-NETWORK-MONITOR-REUSE | iOS 隧道扩展复用已 cancel 的 NWPathMonitor（无法再启动），且 IPv6 变化回调在首次建图之后才接上，期间的变化会让图停在旧路径 | in-PR | 待开（fix/t1-ios-state） | 中·源码推导 | 每次启动新建 monitor；接上回调后若 IPv6 与建图时不同则重建一次。NWPathMonitor/NE 无 TonoKit 可测缝，未写单元回归，仅 CI 原生编译；同一扩展实例再次 startTunnel 的情形与真机网络切换均未验证 |

证据（修复前，main 322f48c6f）：`apps/ios/PacketTunnel/UnderlyingNetwork.swift:12,41,44`（`let monitor`，`stop()` cancel 后 `start()` 再用）；`apps/ios/PacketTunnel/PacketTunnelProvider.swift:57-72`（`startService` 之后才设 `onIPv6Change`）。来源：Antigravity 最终报告 #19（P2）。
