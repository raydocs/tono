| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W7 | Windows DNS 恢复的「实时」证明读回的是恢复自己刚写的注册表，不是 DNS Client 实际使用的解析器，恢复可能被判为已证明而适配器仍指向 Tono | open | 待开 | 中·推导（读码，未核实到实机） | 尚无修复 |

来源：2026-09-28 砖机审计推迟项，codex WINDOWS-1。证据（行号为 `c0e7758e`）：`service/src/core/dns/engine.rs:1252-1308,710`、
`service/src/core/dns/mod.rs:2706,2770`。
