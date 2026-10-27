## 2026-10-27 · iOS：主应用不再重复静态链接 libbox，速度读数改走隧道消息
- 归属：ops 计划外的移动端测试客户端（不属 SHIP_PLAN 门；iOS 不在本发范围）；`apps/ios`。
- 来源：堆叠在 #1799（`amp/mobile-energy-idle-work`）上 → 分支 `amp/ios-single-libbox`；未合 main。
- 新增/优化：主应用只为版本号与 1 s 速度读数链接了一整份 libbox（Go 运行时 + sing-box）。改后只有 PacketTunnel 扩展链接 libbox；app 每秒发 `TunnelMessage.traffic`（只读，2 s 超时，同一时刻最多一个），扩展用自己进程内的命令客户端读核心统计，app 5 s 不问就关掉。无回复、旧扩展的 "unknown message"、"unavailable" 都按断流处理（速度清零、退避 1→30 s 后重问），不碰隧道。关于页的核心版本改由 `TONO_SING_BOX_VERSION`（Base.xcconfig，`tools/check-singbox.sh` 校验与 pin 一致）提供，隧道 `status` 回复仍会覆盖为实际运行版本。
- 保留行为：隧道启停、kill switch（includeAllNetworks、On Demand）、路由、探测、共享状态都不变；扩展 50 MB 内存限制下只多一个按需的本地命令客户端。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：真机上的 provider message 往返、扩展内命令客户端与内存余量未测（无 iPhone / 签名团队）；体积差来自 CI 未签名 Release 构建，不是 App Store 瘦身后的下载大小。
