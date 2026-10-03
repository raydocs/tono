| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STOP-REPAIR-GATE-IO | An I/O error opening or locking the repair gate during an SCM stop was read as an installer owning the stop, so protection was not released (WinSvcIPC H-IPC-2) | fixed(99440eb1) | #1229 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

Only a gate another process holds (`Ok(None)`) fences the stop now; update/installer evidence (`release_admission`)
still does.
