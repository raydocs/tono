| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STARTUP-RECONCILE-STUCK | A failed startup reconciliation left an unverified barrier with nothing to retire it, so the Service stayed Blocked (WinSvcIPC H-IPC-1) | fixed(99440eb1) | #1229 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

Startup retries reconciliation three times, 2 s apart, then retires the unverified barrier through the decision-031
release (AI hold kept) and settles Core replay. Core starts stay gated on reconciliation, which every start retries.
