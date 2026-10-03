| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4SW-MAC-PROOF-TARGET | macOS unarmed recovery 证明备用 TCP 节点可达后仍连接旧的失效选择 | fixed(42389cb9) | #1086 | 中·已确认 | P1; XCTest/native network behavior require CI / needs-hardware |

#720 remembered an ExitHeal alternative and proved that name, but invoked `connect()` without selecting it. Connect therefore captured the unchanged failed preferred node and could install PF for a node the proof had not established. Apply and persist the exact proved candidate synchronously before admission; retain generation, state and selected-name fences after asynchronous proof. One actual AppState regression makes only the backup reachable and captures the admitted name through the restart-record seam before privileged work.
