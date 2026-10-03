| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4MA-MAC-UPDATE-COMMIT-RELEASE-RACE | Restore during a successor's native update Commit hit a helper-refused pending-only Disconnect and left stale local update gates and Core running | fixed(33a5cfce) | #1151, branch `claude/fix-1132-1151-update-release` | 中·推导（P2） | XCTest runs only in hosted CI; installed successor Commit/Restore timing needs hardware. |

When the pending-update release fails, the app re-reads authenticated `/update/status`; only `pending=false` clears the local gates and hands release to the ordinary teardown with the caller's disposition. An unreadable status keeps the previous behavior.
