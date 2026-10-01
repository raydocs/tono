| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DHCPV6-RELAY-SOURCE | Armed WFP rejects legitimate DHCPv6 relay replies whose source is outside fe80::/10 | open | 本 PR audit · hunt/sol-r3wfp-core-exhaustion | 低·已确认（P2，规则模型） | Decision item: widening the deliberate inbound permit requires a safe server/service identity design. Native Windows DHCPv6 and installed-device lease behavior are unrun; no production rule change included. |

`core/wfp_model.rs:451–466` requires UDP 547 → 546 replies to originate in `fe80::/10` in every armed mode. [MikroTik's official firewall documentation](https://help.mikrotik.com/docs/spaces/ROS/pages/48660574/Filter) explains that legitimate DHCPv6 relay sources can be outside the link-local range. In an isolated source copy, one narrow relay-packet regression fails with Block instead of Permit; the 32 existing model tests pass. This proves the model restriction, not an actual Windows lease failure.

The current test at `wfp_model.rs:1760` deliberately denies global inbound DHCPv6 peers. Removing the prefix check would widen intentional strict fail-closed behavior and port-only permits. Leave the rule unchanged pending identity-scoped design and device evidence, per the hunt's top rule.
