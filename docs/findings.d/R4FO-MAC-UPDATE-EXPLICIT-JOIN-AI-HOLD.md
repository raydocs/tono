| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FO-MAC-UPDATE-EXPLICIT-JOIN-AI-HOLD | macOS pending-update automatic release dropped an explicit Restore that joined while the helper worked, so the AI hold stayed | in-PR | #1132, branch `claude/fix-1132-1151-update-release` | 中·推导（P2） | XCTest runs only in hosted CI; installed update/Restore timing needs hardware. |

The joining Restore now records its remove-AI intent; once the automatic release settles under the same generation, the dispatcher routes one plain release (update Disconnect while still pending).
