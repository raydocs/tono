## 2026-09-30 · Windows 安装门禁超时退出与重启待办修正
- 归属：SHIP_PLAN §2 item 10；Windows 安装/修复助手与原生更新恢复任务，发现 `WIN-INSTALLER-RUNTIME-DROP-HANG`、`WIN-UPDATE-TASK-RETIRE-PATH`、`WIN-INSTALLER-REBOOT-READINESS`。
- 来源：main `64af499a` → 分支 `codex2/win-installer-hangs`；PR #776；已并入 `origin/main` `e504f6f4`。恢复任务路径与 main 的 `recovery_task_command` 相同，冲突取 main。安装门禁仍用 `block_on_abandoning`。
- 缺陷修复：BFE 已 Running 但 WFP RPC 不返回时，门禁超时后临时 Tokio runtime 的析构仍等待 `spawn_blocking`，安装助手不退出且占用 repair gate；`manual_gate`、`begin_manual` 与 `retire_orphaned_owner` 改用既有 `shared::block_on_abandoning`，保留原错误并在后台关闭 runtime。恢复任务删除/查询原固定 `C:\Windows\System32\schtasks.exe`，现与注册共用 OS 系统目录路径，支持 Windows 在其他卷。服务二进制因占用而排队到重启替换时，旧服务原被新协议 revision floor 判为安装失败；现只验证旧服务 IPC 存活，成功仍返回 3010，即时发布保留严格 readiness。
- 新增/优化：无；未改 routes、TUN、WFP/DNS 引擎或网络行为，readiness runtime 保持原等待语义。
- 工程与测试：新增 `installer_gate_runtime_returns_after_a_timed_out_blocking_call`（阻塞调用已开始且超时后仍未结束，runtime wrapper 必须返回）与 `update_recovery_retirement_uses_the_os_system_directory`（删除命令使用给定 D: 系统目录及原参数），每项各一条。重启待办分支直连 SCM、IPC 与 `process::exit`，没有可复用的窄测试 seam；按本任务例外未新增该项测试。
- 验证：当前 Linux 工作树（HEAD `64af499a` + 未提交修改）`git diff --check` 通过；逐行复核 Rust 类型、嵌套 Result/`?`、borrow、imports 与 Windows/standalone cfg，记录由 `tooling/scripts/records.mjs` 读取校验。本机无 cargo、Windows、Swift/Xcode，未编译或执行 Windows Rust 回归、未跑实机；托管 Windows CI 执行该区域测试，本轮尚待运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未复现真实 BFE RPC 挂起、其他卷 Windows 或跨 revision 重启待办安装；runtime 回归只覆盖 wrapper，生产调用点由读码复核，不是实机验收。恢复任务 `/Query` 失败仍按任务不存在处理（原行为，未改）。
