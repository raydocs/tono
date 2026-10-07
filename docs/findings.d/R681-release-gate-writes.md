| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R681-release-gate-writes | Windows `ReleaseKillSwitch` 在只读 `release_admission()` 之前仍经 `acquire_service_repair_gate()` 重设 `ProgramData\Tono`/`bin` 的 DACL 并创建 `.repair.lock`（`core/server/mod.rs:797`，`repair.rs:11`，`windows_security.rs:151-165`）；任一写失败时 Disconnect 被拒 | in-PR | #681 评审 cb8d2f9c → 5a2e265e（opus:F1，codex:F2，grok:F1 同一问题）；修复 [#1437](https://github.com/raydocs/tono/pull/1437) | 中·已确认 | 失败方向 fail-closed，无泄漏；基线已有，非 #681 回归；修法需把释放准入移到修复闸之前或拆出只读闸，归 PLAN-win-admin-release |

停止规则：一轮修复后仍开放（本轮只改为返回真实 I/O/ACL 错误并记日志）。
