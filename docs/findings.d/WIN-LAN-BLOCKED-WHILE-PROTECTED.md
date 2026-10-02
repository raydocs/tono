| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LAN-BLOCKED-WHILE-PROTECTED | Windows 连接期间局域网全部不可达（路由器管理页、打印机、NAS/SMB、DLNA/mDNS 发现和投屏）：WFP 只放行回环、DHCP、NDP、出口节点、TUN 接口和引导 API，没有私网或组播放行；macOS 在有隧道时放行私网、链路本地和发现组播 | in-PR | [#1332](https://github.com/raydocs/tono/pull/1332) 记录；[#1355](https://github.com/raydocs/tono/pull/1355) 修 | 中·推导 | 所有者 2026-10-02 决定放行（[决策 048](../decisions/048-2026-10-02-windows-lan-while-protected.md)）。没有实机验证。不在同网段的私网（另一个 VLAN）仍进 TUN，不在这次范围内 |

依据（`main` `b1df598c`）：`apps/windows/service/src/core/wfp_model.rs` 的 `expected_filters` 没有任何以私网或组播为条件的 permit，`intent/block-all-*` 和 `session/block-all/*` 兜底；同文件测试断言私网地址「must stay unreachable」。sing-box 配置（`apps/windows/crates/tono-core/src/sing_box.rs`）的 `route_exclude_address` 只有节点 `/32`：同网段目的地走物理网卡的在网路由被 WFP 挡住，其他私网段进 TUN 后走 `final: Tono-Exit`，UDP 一律 `reject`。macOS 对应规则是 `KillSwitchPF.renderRules` 的 `tono-lan`、`tono-linklocal`、`tono-mdns`、`tono-igmp`、`tono-multicast`。如果放行，TunnelCrack 的 LocalNet 结论同样适用：只放行不可路由的私网段，不按网卡现算在网前缀。

修复（#1355）：`session_rules` 新增规则 I，只在 `Locked` 且有隧道 LUID 时渲染。出站放行私网、链路本地、ULA 和本地范围的发现组播，远端端口 53/853 不在放行内；入站放行来自私网、链路本地、ULA 的对端；核心进程到这些地址另加阻断。`FILTER_NAMESPACE` 升到 v13。回归 `a_locked_session_reaches_the_lan_but_not_its_dns`。

未关的限制：
- 没有 Windows 实机验证。WFP 的端口范围条件（`FWP_MATCH_RANGE` 于 `IP_REMOTE_PORT`）和同字段多条件取或，在模型里按文档实现，真机上需要确认一次：路由器管理页、SMB、打印、mDNS/SSDP 发现能用，`nslookup example.com 192.168.x.1` 不通。
- 核心的 app id 解析失败时，引擎会连同其他 app 级规则一起丢掉「核心到局域网」的阻断；那时核心也没有出口放行。
- 不在同网段的私网目的地仍按默认路由进 TUN，走出口，UDP 被拒。要改需要动 sing-box 的 `route_exclude_address`，不在这次范围内。
- Windows 防火墙对入站的策略不变（公用网络配置下多数入站仍被它挡住）。
