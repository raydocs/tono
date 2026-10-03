| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ROAM-M1 | macOS 把任意物理 IPv4 变化当成漫游并拆隧道，同服务上网关或 IPv6-only 变化却不重建 | fixed(899f7a88) | [#702](https://github.com/raydocs/tono/pull/702) | 中·推导 | 判定有 XCTest；真机切换、睡眠、门户未测。门户不放开 PF |

已连接时 `PhysicalInterfaceFingerprint` 含每块 up 的物理 IPv4。插上扩展坞会改变指纹，`scheduleNetworkEnvironmentReconciliation` 在 Kill Switch 仍武装时 `disconnect`。同一 Wi-Fi 服务、地址不变、只换网关时指纹不变，会话留在旧路由上。动态库短暂没有 PrimaryService 时 `nil != 服务名` 也会拆隧道。

本分支改为只比较默认上行。`.moved` 才重建。`.inconclusive` 保留基线。
