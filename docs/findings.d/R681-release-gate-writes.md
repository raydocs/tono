| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R681-release-gate-writes | Windows `ReleaseKillSwitch` 在只读 `release_admission()` 之前仍经 `acquire_service_repair_gate()` 重设 `ProgramData\Tono`/`bin` 的 DACL 并创建 `.repair.lock`（`core/server/mod.rs:797`，`repair.rs:11`，`windows_security.rs:151-165`）；任一写失败时 Disconnect 被拒 | fixed(5f4ae256e) | #681 评审 cb8d2f9c → 5a2e265e（opus:F1，codex:F2，grok:F1 同一问题）；修复 [#1437](https://github.com/raydocs/tono/pull/1437) | 中·已确认 | 失败方向 fail-closed，无泄漏；基线已有，非 #681 回归。#1437：取锁失败时 Release 改用只读探测（打开已有 `.repair.lock` 并加锁，不重设 DACL、不创建）；探测到被持有仍拒绝；探测也打不开或锁不上时不带锁继续，只靠只读 `release_admission`（挂起记录、手动租约）与 `authorize_write_for`。剩余（#1437 评审 412fc5c2 codex:F1，minor，停止规则后开放）：探测打不开文件与安装程序持锁仍可能同时成立，此时与无租约的直接修复（`tono-service-install.exe` 无参数）之间无互斥；释放路径仍会先尝试一次 DACL 重设；未实机 |

停止规则（#681 当轮，历史）：一轮修复后仍开放（当轮只改为返回真实 I/O/ACL 错误并记日志）。2026-10-07 由 #1437 修复，见上表剩余限制。
