| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LAN-BLOCKED-WHILE-PROTECTED | Windows 连接期间局域网全部不可达（路由器管理页、打印机、NAS/SMB、DLNA/mDNS 发现和投屏）：WFP 只放行回环、DHCP、NDP、出口节点、TUN 接口和引导 API，没有私网或组播放行；macOS 在有隧道时放行私网、链路本地和发现组播 | open | [#1332](https://github.com/raydocs/tono/pull/1332) 记录，未改 | 中·推导 | 产品决定，未改代码：放行局域网等于放宽 WFP，需要所有者定（是否放行、是否做成开关、放行哪些段）。读码推导，没有实机验证 |

依据（`main` `b1df598c`）：`apps/windows/service/src/core/wfp_model.rs` 的 `expected_filters` 没有任何以私网或组播为条件的 permit，`intent/block-all-*` 和 `session/block-all/*` 兜底；同文件测试断言私网地址「must stay unreachable」。sing-box 配置（`apps/windows/crates/tono-core/src/sing_box.rs`）的 `route_exclude_address` 只有节点 `/32`：同网段目的地走物理网卡的在网路由被 WFP 挡住，其他私网段进 TUN 后走 `final: Tono-Exit`，UDP 一律 `reject`。macOS 对应规则是 `KillSwitchPF.renderRules` 的 `tono-lan`、`tono-linklocal`、`tono-mdns`、`tono-igmp`、`tono-multicast`。如果放行，TunnelCrack 的 LocalNet 结论同样适用：只放行不可路由的私网段，不按网卡现算在网前缀。
