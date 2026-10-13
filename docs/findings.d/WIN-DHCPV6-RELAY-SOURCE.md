| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DHCPV6-RELAY-SOURCE | Armed WFP rejects legitimate DHCPv6 relay replies whose source is outside fe80::/10 | accepted-design | [#1056](https://github.com/raydocs/tono/issues/1056) · [决定 127](../decisions/127-2026-10-13-dhcpv6-reply-permit-stays-link-local.md)（provisional） | 低·已确认（P2，规则模型） | 保持入站 DHCPv6 回复许可限定 fe80::/10，不放宽；经全局/ULA 源中继取得有状态 DHCPv6 的网络是已知限制，保护期间只丢 IPv6 租约，IPv4 DHCP（入站仅按端口）与隧道不受影响（已在代码核对）。放宽需要不可伪造的身份（Dhcp 服务 SID 或租约学到的服务器身份），与 TW-OpenAI-1（#602）同属需设备的一项。原生 Windows 的该网络表现未运行。 |

`core/wfp_model.rs:451–466` requires UDP 547 → 546 replies to originate in `fe80::/10` in every armed mode. [MikroTik's official firewall documentation](https://help.mikrotik.com/docs/spaces/ROS/pages/48660574/Filter) explains that legitimate DHCPv6 relay sources can be outside the link-local range. In an isolated source copy, one narrow relay-packet regression fails with Block instead of Permit; the 32 existing model tests pass. This proves the model restriction, not an actual Windows lease failure.

The current test at `wfp_model.rs:1760` deliberately denies global inbound DHCPv6 peers. Removing the prefix check would widen intentional strict fail-closed behavior and port-only permits. Leave the rule unchanged pending identity-scoped design and device evidence, per the hunt's top rule.
