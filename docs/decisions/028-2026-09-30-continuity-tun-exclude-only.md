## 2026-09-30 · Continuity 要不要改 PF 在网放行或组播状态

- Status: provisional
- Chosen: 只把静态、不可路由的前缀（有限广播 `255.255.255.255/32`、IPv6 组播 `ff00::/8`，加上原先已排除的私网/链路本地/IPv4 组播）放进 sing-box `route_exclude_address`，让 Darwin auto-route 不要把它们装进 utun。不改 PF、不升级 helper、不按网卡现算在网前缀、不把 mDNS/链路本地从 `keep state` 改成 `no state`、不恢复 Apple 进程的公网 DIRECT。
- Why stricter: 连接时 Kill Switch 在 TUN 起来之前就已经武装。动态 PF 或未在 Mac 上解析过的规则一旦写坏，整份规则装不进去，恢复仍要靠已有的 Restore internet，但这次改动本身不能增加那条路径的失败面。排除有限广播不会打开公网，也不替换默认路由。在网全球 IPv6 / 非私网 IPv4 仍按现有 Kill Switch 丢弃，直到有实机证明一条静态、可重复的放行。
- Applied in: [#700](https://github.com/raydocs/tono/pull/700) `cursor/macos-continuity-onlink-3d9f`（`ConfigPipeline.tunRouteExcludeCIDRs`）。
