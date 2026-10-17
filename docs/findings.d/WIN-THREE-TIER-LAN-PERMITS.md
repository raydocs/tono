| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-THREE-TIER-LAN-PERMITS | 严格三层会话的物理WFP许可仍继承stable局域网例外，与路由图的LAN/IPv6/UDP拒绝合同不一致 | in-PR | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 续修从strict意图派生关闭LAN许可，stable保持原合同；实际FilterSpec仲裁回归与Service传递断言已补，准确head CI/独立复核待完成，非设备泄漏证据 |

来源：独立high审查准确head [0c60a578](https://github.com/raydocs/tono/commit/0c60a578b0d3bc76197fd5d134f3617959914eed)。Core内拒绝不替代物理接口准入；本项只记录合同错配，不公开绕过步骤。保留TUN捕获通道及最小网络基础设施，不扩大strict支持范围。
