| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HOT-SWITCH-PROTOCOL-CHANGE | Windows VLESS 与 HY2 热切换只换选择器和 WFP 端点，运行时保留旧传输的 UDP 规则，导致 UDP 被误拒绝或落入 DIRECT 回退 | in-PR | 待开 | 高·推导 | 传输改变或旧节点未知时改走现有保持 WFP 武装的冷重建；单元测试未运行，双向切换及失败恢复需实机；needs-hardware |

回归：`hot_switch_requires_known_matching_transport`。仅源码，未合 main，无新候选。
