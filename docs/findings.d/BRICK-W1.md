| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W1 | Windows 意外重启（崩溃、蓝屏、断电）后没有开机会话守卫：Service 在任何人登录前按上次的运行意图启动 Core；原生更新替换后被重启打断时，此后每次登录的 App 都自己 Connect 去完成更新 | in-PR | [#680](https://github.com/raydocs/tono/pull/680) | 中·已确认（读码，Codex+Opus 交叉核实）；崩溃循环本身未证实 | 修复：运行意图记下写它的那次开机（Service 注册表键下的易失子键 `BootSession`），Service 启动只在同一次开机、且已恢复出 wanted 屏障时才重放，否则保持、不改写；更新恢复的自动 Connect 只在执行器自己启动的那个 App 进程、且 Adopt 给出确定答案后才开，Adopt 失败、答案不确定或重新启动的 App 在本进程内一律保持。仍剩：没有「意外重启」提示；登出释放没完成的计划内重启之后也要点一次 Retry；保持期间「更新恢复未完成」横幅与 Protected Offline 同时显示；Adopt 失败时该 App 进程也保持；48 小时收据过期后的死路仍在（BRICK-W6）；未实机验证（D1、D6） |

来源：2026-09-28 砖机审计（origin/main `c0e7758e`），opus WIN-1 + E5，跨厂商核实。证据（行号为 `c0e7758e`）：
`service/src/bin/service.rs:397-403,619-658`、`service/src/core/desired.rs:211-267`（Service 重放）；
`app/src-tauri/src/tono/commands/restore.rs:189-205`、`commands/update.rs:264-279`（App 更新恢复）。
方向：PLAN-win-boot-uninstall 第 3 版（Jev 533a3cfc，计划评审 38c453fa 通过）。

开机标记在 Service 键下而不是更新收据里：收据是与 macOS 共享的 v1 契约。易失键在完整关机、崩溃与断电后都不在，
快速启动（Fast Startup）关机保留它和运行中的 Service，按同一次开机处理；重新全新安装会重建 Service 键，于是也保持旧意图。
wanted 屏障条件同时关住紧急解除之后同一次开机里 Service 再启动重放 Core 的路径：BRICK-W2 交还租约后，租约不再顺带挡住它。
