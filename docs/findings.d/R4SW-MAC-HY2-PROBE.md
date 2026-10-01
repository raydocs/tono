| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4SW-MAC-HY2-PROBE | macOS 自动恢复记住 HY2 备用后只做该节点的 TCP 证明，永远不重试可用 Reality 节点 | in-PR | #1086 | 中·已确认 | P1; XCTest/native reconnect require CI / needs-hardware |

ExitHeal ranks the same-node HY2 alternative first for a TCP failure; TcpEndpointProof deliberately cannot prove HY2. The old unarmed loop tried only that remembered candidate, suppressing all future TCP retries even after the preferred Reality endpoint recovered. Build a bounded preferred-first list of eligible same-region TCP candidates, with at most two alternatives; UDP nodes cannot suppress them. A narrow candidate regression covers a remembered HY2 sibling and available preferred/backup TCP nodes. No TLS or AI-routing checks are weakened.
