| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4MH-SIGNEDOUT-LAUNCH-AI-HOLD | macOS signed-out cold launch sent the explicit `/killswitch/disarm`, removing an AI hold that automatic recovery had retained | fixed(b0f0bd27) | #1117, branch `claude/fix-1117-signedout-ai-hold` | 中·推导（P2） | XCTest runs only in hosted CI; installed revoked-session + force-quit relaunch needs hardware. |

The signed-out launch now reads authenticated `/killswitch/status` (present on every helper). Only a confirmed "nothing held" skips the full disarm and restores DNS; unavailable/rejected status or a DNS failure keeps the previous full release. No new helper endpoint is used, so older helpers keep the old behavior and sign-in is unaffected.
