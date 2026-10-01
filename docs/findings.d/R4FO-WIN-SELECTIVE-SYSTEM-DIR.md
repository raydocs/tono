| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FO-WIN-SELECTIVE-SYSTEM-DIR | Selective recovery invokes netsh from C:\Windows even when Windows is installed on another volume, omitting the Anthropic IP hold | in-PR | hunt/sol-r4fo-selective-system-dir (this PR) | 低·已确认（P2） | Linux production-command regression failed then passed; native GetSystemDirectoryW/netsh and non-C installation require Windows CI and hardware |

`selective_fail_open.rs` keeps fixed, prefix-only command templates. The native runner previously executed their C-drive marker directly. It now retains template validation and binds the executable to the existing OS-reported system-directory provider, without consulting PATH or environment variables. NRPT, prefix lists, strict protection and explicit Restore semantics are unchanged.
