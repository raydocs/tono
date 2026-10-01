| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RETIRE-FOREIGN-OWNER | The Service retire of an expired fresh arm refused on an unreadable or foreign active-owner record every tick, so the session stayed Blocked (RegLate REG-1074) | in-PR | #1229 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

Unreadable record: stop and retire the Core as unrecorded, as the owner-gated release does. Foreign readable record: keep
that owner's Core and record, and release the abandoned arm with the AI hold (decision 031).
