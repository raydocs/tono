| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4SW-MAC-CATALOG-AI-HOLD | New catalog removal release paths select full user disarm and remove AI floor | fixed(8524cf72) | #1103 | 中·已确认 | P1; native XCTest and needs-hardware pending |

New merged #963/#966 callers omitted `automaticFailureRelease` and selected `networkProtection.disarm` after successful Core stop and DNS restore. That operation removes the AI floor. The existing `releaseAfterFailure` operation uses `/killswitch/release` and `preserveAIHold:true`, retaining AI domains/Claude IPs while reopening ordinary traffic. Propagate its intent only through the automatic catalog/switch/policy release callers; explicit Restore and strict branches retain their semantics. Actual AppState tests replace only privileged I/O and require the AI-preserving operation, with zero full disarms. No helper contract change.
