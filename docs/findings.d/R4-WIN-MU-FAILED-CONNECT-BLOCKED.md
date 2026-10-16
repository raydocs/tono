| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-MU-FAILED-CONNECT-BLOCKED | 用户 A 注销时释放失败，策略以 owner A 保持武装；用户 B 点 Connect，`PrepareCoreStart` 停掉 A 的 Core，B 的尝试在 `arm_bootstrap` 之前失败，`fail_connect` 的释放被 `authorize_write_for` 以 owner A 拒绝，B 从在线变成 Blocked | open | [#1293](https://github.com/raydocs/tono/issues/1293)（第 1 项） | 低·推导（P3，读码） | 需要所有者决定：见补充说明 |

补充说明（2026-10-13，未改代码）：能修的只有放宽释放权限，而它碰特权释放路径：要让 `authorize_write_for`（`core/windows_kill_switch/session.rs`，`ArmedPolicyRelease` 门）以及“恢复上网”的 `release::worker::owner_refusal`（`core/release/worker.rs`，它读 `persisted_intent_owner` 和 `load_active_owner`）都在“记录的 owner 已无登录会话”时放行别的用户，规则与 `authorize_takeover_for` 对称（B 其实已经可以先接管再断开）。这放宽跨用户释放权限，按 AGENTS.md 属 PF/WFP、特权路径的高风险改动，需要所有者确认“owner 已注销 = 无人需要保护”能用于释放，并需要双账号实机复现（A 注销且释放失败、B 连接在 arm 之前失败）。另一条不放宽权限的路线：`PrepareCoreStart` 在 owner 已注销时，不在 B 的 `arm_bootstrap` 前停 A 的 Core（Core 留给接管那一步），但会改 StartClash/PrepareCoreStart 的顺序，同样需要实机。
