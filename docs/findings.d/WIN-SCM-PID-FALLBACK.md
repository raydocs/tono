| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SCM-PID-FALLBACK | Service 强制停止信任崩溃遗留 PID 文件，可误杀复用该 PID 的无关用户进程 | fixed(ad53abb6) | 本 PR · hunt/sol-r3proc-service-pid-image | 低·推导（P2） | Windows 原生回归已写，VM 未执行；Linux 既有安装/卸载测试通过，Windows GNU 交叉检查通过；实机和托管 Windows CI 待验 |

基线 `0ad57ccd`：`apps/windows/service/src/core/owner.rs:33–35` 只在正常 Drop 删除 PID 文件，进程崩溃或被强制终止留下旧 PID。`bin/uninstall_service.rs:486–493` 在 SCM 查询/正常停止失败后进入 force-stop；`bin/shared/mod.rs:160–168` 甚至在第二次 SCM 查询已成功报告 Stopped / 无 PID 时仍读旧文件，再调用 `:198–243` 的裸 PID 终止。旧 PID 已被无关应用复用时会误杀该应用。另一个服务专用裸 PID 调用在卸载 owner-lock 分支 `bin/uninstall_service.rs:527–534`。需要崩溃遗留文件、PID 复用与 SCM 失败/停止窗口，所以仅 P2。

修复：SCM 明确 Stopped 时直接认定停止，不读 PID fallback。其他需要升级的服务停止在同一个 `OpenProcess` handle 上查询 image，验证规范化路径等于已安装 `service_paths().install_dir()/tono-service.exe`（不区分 ASCII 大小写），才 TerminateProcess 并有界等待；已消失/确定不是该 image 的进程不动，force-stop 仍要用 SCM 状态证明停止。不能检查身份仍报错。`install_service/update_executor.rs:438` 针对发起 GUI 的通用终止语义与权限不变。

一个 Windows 回归 `shared::tests::service_termination_does_not_kill_a_different_executable`：真实 PowerShell 子进程、现存测试 executable 作为不同 expected image，必须拒绝并保留子进程，RAII 在失败也 kill/wait 清理。先写测试与旧终止 forwarding fixture；此 VM 不能原生执行 Windows，未声称实际 baseline 失败或 fixed 通过。Linux 既有 installer 17 / uninstaller 22 测试通过；Windows GNU `cargo check` 编译通过（不是原生运行）。AI 阻断、strict、DNS/WFP 释放证明和 NSIS 结果契约未改。已丢失安装 image 且身份无法证明时仍拒绝终止，不能凭进程名杀用户程序。
