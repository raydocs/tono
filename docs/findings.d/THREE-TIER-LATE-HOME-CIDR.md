| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| THREE-TIER-LATE-HOME-CIDR | 三层普通/国内域名的晚解析结果没有重检既有Home保护CIDR，可能误入DIRECT | fixed(6ec54b538) | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 已合main；两条DIRECT前重检保护CIDR，视频/具名云优先级保留；注入DNS顺序回归及准确head CI/独立high通过（PR最终回执6233035109）。待实机：实际Core解析/出口，不把图解释器称设备泄漏实测 |

来源：独立high审查准确head [6791167fc](https://github.com/raydocs/tono/commit/6791167fc7ee10c45b7ba18e997eb7fd5cd3f742)。共享图生成到Swift并被Rust/Helper/Service精确准入；解析只丰富地址，不会重走前置规则。本项记录合同错配，不公开利用步骤。
