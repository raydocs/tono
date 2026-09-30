| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-EMPTY-GRAPH-LOOP | Windows DIRECT 的 suffix-only 计划没有生成 controller DIRECT 规则，仍打开 Service reload bracket，随后空图被拒绝，进入 Blocked 与重连循环 | in-PR | #786 | 高·推导 | Windows Rust 回归未运行，hosted Windows CI 待跑；空图跳过后的联网状态需 Windows 实机，needs-hardware |

计算 `expected_controller_direct_rules` 后，空规则图返回 `Ok(None)`，在 runtime staging 与 Service reload bracket 前跳过可选 DIRECT overlay。归属 SHIP_PLAN §2 第 10 项 / G1 Windows DIRECT；仅源码，未合 main，无新候选。
