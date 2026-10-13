## 2026-10-13 · 记录：#1056 逐行收口，#602 只剩需设备的一项
- 归属：工程流程（仅文档记录），不属于 SHIP_PLAN 门或运维计划条目；不改任何代码。
- 来源：基线 origin/main → 分支 `claude/records-1056-602-close`；Refs #1056、#602；决定 [127](../decisions/127-2026-10-13-dhcpv6-reply-permit-stays-link-local.md)（provisional）。
- 记录：WIN-DHCPV6-RELAY-SOURCE 记为 `accepted-design`：入站 DHCPv6 回复许可保持限定 fe80::/10（放宽会让任意主机在保护期间打开到 546 端口的流），全局/ULA 源中继网络是已知限制；已在代码核对只影响 `intent/permit-dhcp-v6-in`，IPv4 DHCP 入站仅按端口、隧道不带 IPv6，均不受影响。#1056 其余三行与 #1284、win2-F3 的发现分片由 `in-PR` 改为 `fixed(<main SHA>)` 并链接 PR。TW-OpenAI-1（#602）账本行写明设备测试必须证明的三件事，代码不动，#602 以 needs-hardware 保留此一项。
- 新增/优化：无。
- 验证：`node tooling/scripts/records.mjs findings` 读取；无代码，未运行测试。
- 候选/发布：仅文档，无新候选。
