| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SCM-STOP-KEEPS-BLOCK | Windows 非严格连接经 SCM Stop / Preshutdown 停 TonoService 时只停 Core，遗留持久 WFP 阻断和指向已停止解析器的保护 DNS；正常 Stop 不触发 SCM 故障恢复 | in-PR | #792 | 中·推导 | 修复复用 DNS → Core 停止/运行意图退役 → 标准 WFP release；严格、更新 pending、有效安装租约或 repair 持闸时保留。停止清理限 60 秒，失败/超时记日志后继续；恢复失败仍可能留下保护。需 needs-hardware，Windows hosted CI / 实机未执行；#738 / #740 不在本修复范围 |

2026-09-30：在 main `378c165d` 读码复核，`bin/service.rs` 的 SCM Stop / Preshutdown 与 owner goodbye 汇入 `run_ipc_supervisor_until_shutdown`，`core/server/mod.rs::stop_ipc_server` 原来只有 `CORE_MANAGER.stop_core()`；后者先撤回 DIRECT 许可到 Blocked，不恢复 DNS或 disarm。分支 `codex2/win-scm-stop-fail-open` 改走 Disconnect 同用的 `windows_kill_switch::release()`，并在解除前退役旧运行意图。

更新/安装边界用已有 `update::release_admission()` 只读准入和 `acquire_service_repair_gate()`，持闸至停止清理结束；installer、executor 和 uninstall 都持此闸跨 SCM Stop，未新增 marker。增加一个纯决策单测；停止标记拒绝排队的 IPC 写操作，runtime 不等待已超时的 blocking worker。仅源码，未合 main、无新候选。
