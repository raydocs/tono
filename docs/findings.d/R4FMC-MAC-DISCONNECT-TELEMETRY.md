| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMC-MAC-DISCONNECT-TELEMETRY | macOS successful Connect cleared the timestamp that `disconnectOk` needed, so connected sessions never reported their disconnect telemetry | in-PR | #1174, branch `claude/fix-1174-disconnect-telemetry` | 低·已确认（P3，诊断，非计费） | XCTest runs only in hosted CI. |

A separate `connectedSessionStartedAt` is set at the successful Connect commit, cleared at each Connect start, and consumed once at teardown.
