| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| THREE-TIER-LATE-HOME-CIDR | 三层普通/国内域名的晚解析结果没有重检既有Home保护CIDR，可能误入DIRECT | in-PR | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 续修在两条DIRECT前重检保护CIDR，保留已终止的视频/具名云优先级；编译器回归注入DNS结果检验保护/普通公网/私网对照。准确head CI/独立增量复核见PR，非设备泄漏证据，未合main |

来源：独立high审查准确head [6791167fc](https://github.com/raydocs/tono/commit/6791167fc7ee10c45b7ba18e997eb7fd5cd3f742)。共享图生成到Swift并被Rust/Helper/Service精确准入；解析只丰富地址，不会重走前置规则。本项记录合同错配，不公开利用步骤。
