| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-INSTALLER-RUNTIME-DROP-HANG | Windows 安装门禁 WFP/DNS 阻塞调用超时后，临时 Tokio runtime 析构仍等待遗留 `spawn_blocking`，助手不退出且 repair gate 持续占用，后续修复返回 75 | fixed(0ad57ccd) | #776 | 中·推导（读码，未实机复现） | 修复：`manual_gate`、`begin_manual`、`retire_orphaned_owner` 使用既有后台关闭 wrapper；未改引擎超时或保护行为；Windows CI 与真实 BFE 挂起待验 |

来源：main `64af499a` → 分支 `codex2/win-installer-hangs`；PR #776；未合 main。沿用卸载助手 BRICK-W4 的 runtime 退出方式；回归 `installer_gate_runtime_returns_after_a_timed_out_blocking_call`，本机未执行。
