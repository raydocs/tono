| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HY2-FAILOVER-SKIPS-OWN-REALITY | macOS 故障转移中，手选的 ` · hy2` 在丢 UDP 的网络上以超时/TLS 失败时，跳过同节点 Reality 块直接换到同区其他节点；Windows `heal::transport_matches` 已修此问题，macOS `ExitHeal.transportMatches` 未移植 | in-PR | 本 PR | 低·已确认（读码 + XCTest） | 未实机；只影响手选 hy2 且失败文本不含 QUIC 的情形 |
