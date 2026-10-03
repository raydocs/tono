| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESTORE-SUPERSEDED-PROBE | A sign-in that superseded startup restore skipped the stored-protection probe, so a stale armed barrier showed as Disconnected and the Service-truth poll never watched it (RegLate H3-restore, from #1045) | fixed(99440eb1) | #1229 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

The superseded restore still probes and folds an armed or unknown reading into Protected Offline when no Connect or
release was admitted meanwhile. It never marks the session verified, so auto-reconnect stays out of it.
