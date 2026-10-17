| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-THREE-TIER-LAN-PERMITS | 严格三层会话的物理WFP许可仍继承stable局域网例外，与路由图的LAN/IPv6/UDP拒绝合同不一致 | fixed(6ec54b538) | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 已合main；strict关闭LAN许可、stable原合同保留；实际FilterSpec仲裁/Service传递回归及准确head CI/独立high通过（PR最终回执6233035109）。待实机：LAN/IPv6/UDP流量对照，非设备泄漏证明 |

来源：独立high审查准确head [0c60a578](https://github.com/raydocs/tono/commit/0c60a578b0d3bc76197fd5d134f3617959914eed)。Core内拒绝不替代物理接口准入；本项只记录合同错配，不公开绕过步骤。保留TUN捕获通道及最小网络基础设施，不扩大strict支持范围。
