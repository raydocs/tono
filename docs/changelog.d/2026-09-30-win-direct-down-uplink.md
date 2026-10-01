## 2026-09-30 · Windows DIRECT 绑定跳过未启动的硬件网卡
- 归属：SHIP_PLAN §2 第 10 项（直连流量绑到断开的网卡）；影响 Windows 连接前的物理出口选择。
- 来源：main `5ba113d2` → 分支 `hunt/grok-winapp-down-uplink-2a89`；PR 待开；未合 main。
- 缺陷修复：默认路由候选里，未启动的硬件别名不再当作 DIRECT 绑定。后面仍有已启动的网卡时用它；全都未启动时沿用原来的发现失败，可选 DIRECT 被跳过，全隧道保留。关联 `WIN-DIRECT-DOWN-UPLINK`。
- 新增/优化：无。
- 工程与测试：`direct_bind_skips_a_down_hardware_alias`。
- 验证：本机 rustc 1.83 无法编译 edition 2024，未运行 `cargo test`。hosted Windows CI 执行。未读实机的 IP Helper 表。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。断开的以太网是否仍留在 IPv4 默认路由表里需实机确认。
