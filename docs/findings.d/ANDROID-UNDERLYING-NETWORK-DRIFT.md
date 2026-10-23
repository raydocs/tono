| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-UNDERLYING-NETWORK-DRIFT | Android VPN 建立后仍声明初始上行，且未按源码意图继承当前网络的计费属性 | open | 待开 | 中·推导（P2） | 新回归尚未执行；旧云 VM 两次模拟器 SIGSEGV 不是复现；真机及不同 API 待验 |

来源：2026-10-23 Sonnet 基线审计 F3，根线程核对当前 `ca40f3baa`。
`BoxPlatform.openTun` 原先仅在 Builder 写一次上行；`TonoVpnService.onUnderlyingChanged`
只刷新探测或按 IPv6 变化重载，未更新存活 VPN 的网络声明。
AOSP 的 [VpnService 契约](https://developer.android.com/reference/android/net/VpnService#setUnderlyingNetworks(android.net.Network[]))
要求实际上行变化时同步声明；空数组表示无上行，null 表示跟随系统默认，不能混为同一状态。

同时纠正审计假设：[Builder.setMetered](https://developer.android.com/reference/android/net/VpnService.Builder#setMetered(boolean))
对 target Q+ 默认始终 metered，而不是继承物理链路。原实现未调用 setMetered(false)，
因此**没有证据支持原审计推测的“蜂窝被误当成免费流量”**；本项是网络元数据不一致，非已确认计费泄漏。

候选修复：TUN 建立、每次底层变化后按 monitor 的最新值同步；无上行用空数组；
open/update/close 在同一平台锁内，旧排队回调不携带旧 Network 写入新 TUN，关闭后不更新。
Builder 显式 setMetered(false)，使 meteredness 由当前上行决定；不改变 VPN consent、路由或 TLS。

验收：新增一个独立 instrumentation 方法，真实 service + libbox + TUN + 本地替身，
Wi-Fi → 蜂窝 → Wi-Fi → 无上行 → 恢复 → 断开，断言同一 VPN/TUN 身份、公共 transport/metered 属性。
不调用被隐藏/脱敏的 NetworkCapabilities.getUnderlyingNetworks；原始 dumpsys 留给实际声明核对。
只观察到普通网络 101→100→102 可切换，尚未取得同 TUN 的旧行为 RED 或修复 GREEN。
