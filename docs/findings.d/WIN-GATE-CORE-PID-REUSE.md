| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-GATE-CORE-PID-REUSE | 卸载不删除 `ProgramData\Tono\runtime\tono-service.core.json`；重启后该 pid 被一个无法读取映像的进程（`Registry`、`MemCompression`、受保护进程）复用时，门禁的进程身份读取报错，每次安装都被拒绝 | fixed(6226b604) | #669 | 低·推导（读码，未实机复现） | 修复：读取失败时用 Toolhelp 列出的映像名区分，名字不同即判为过期记录；没有已注册的 Service 时删除过期记录。同名或读不到名字仍拒绝（`TONO_INSTALL_CORE_RUNNING`，提示重启） |

来源：WIN-GATE-OPAQUE 的拒绝路径枚举（2026-09-27）。回归测试 `core::update::tests::update_manual_gate_treats_a_reused_core_pid_as_a_stale_record`。
