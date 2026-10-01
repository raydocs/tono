## 2026-09-30 · Windows 更新恢复任务按系统目录退休
- 归属：SHIP_PLAN §2 第 10 项（更新/卸载后不该留下开机任务）。Windows Service `core/update.rs`。
- 来源：基线 origin/main `c26025ec`。分支 `hunt/grok-winsvc-retire-schtasks-d3c7`。未合 main。
- 缺陷修复：`retire_recovery_task` 的 `/Delete` 与随后的 `/Query` 改用 `security::system_directory()` 下的 `schtasks.exe`，与 `recovery_task_registration` 相同。系统盘不是 `C:` 时，已提交更新的 `finish_committed` 和最终卸载都能退休 `Tono Update Recovery v1`。发现 WIN-UPD-RETIRE-SCHTASKS。
- 新增/优化：无。
- 工程与测试：`update.rs` 一条 `#[test]`（`update_recovery_retirement_uses_the_os_system_directory`）：系统目录为 `D:\Windows\System32` 时，删除和查询命令的程序都是 `D:\Windows\System32\schtasks.exe`。
- 验证：该测试在 `#[cfg(all(feature = "standalone", windows))]` 的 `update.rs` 里，本 Linux 环境不能编译。以 PR 的 windows-ci 为准。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机删除任务；调度程序本身不可用时退休仍失败，任务留到下次开机重试（原设计）。
