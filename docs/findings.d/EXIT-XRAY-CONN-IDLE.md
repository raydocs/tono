| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-XRAY-CONN-IDLE | 出口新生成的 Xray 配置没有显式空闲策略，长时间静默的会话可能被默认空闲超时切断 | open | 待开 | 低·实机 | 默认值与真实断流来源未证实，需隔离节点做受控 echo 实验；确认后缺省值设为有界的较长值并保留已有显式值，重启需配合 EXIT-RESTART-IDENTITY-GAP（#1378） |

Codex 核验 NEEDS-HARDWARE。HY2-IDLE-MIHOMO 是另一传输的保活限制。记录于 #1386。
