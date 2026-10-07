| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W7 | Windows DNS 恢复的「实时」证明读回的是恢复自己刚写的注册表，不是 DNS Client 实际使用的解析器，恢复可能被判为已证明而适配器仍指向 Tono | in-PR | [#1449](https://github.com/raydocs/tono/pull/1449) | 中·推导（读码，未核实到实机） | 证明改读 `GetAdaptersAddresses` 实际列表；未实机验证；不检查期望服务器是否出现；保存值本身是纯本地解析器的适配器仍整体豁免实时证明（`adapters_owing_live_proof`，含其 `198.18.0.2`，评审 `fb08bc2f` minor） |

来源：2026-09-28 砖机审计推迟项，codex WINDOWS-1。证据（行号为 `c0e7758e`）：`service/src/core/dns/engine.rs:1252-1308,710`、
`service/src/core/dns/mod.rs:2706,2770`。
