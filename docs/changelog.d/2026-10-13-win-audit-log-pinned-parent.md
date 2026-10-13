## 2026-10-13 · Windows：审计日志的恢复重开绑定到已打开的父目录
- 归属：SHIP_PLAN §2 item 10；Windows App 审计日志（`apps/windows/app/src-tauri/src/tono/audit.rs`、`state.rs`）。
- 来源：基线 origin/main → 分支 `claude/win-audit-pin`；Refs #602（win2-F3）；无需产品决定。
- 缺陷修复：审计写入任务崩溃后的自愈重开按路径打开日志，私有文件原语只检查最后一段路径，父目录若被换成目录联接（junction）/符号链接可重定向写入（第一次打开同理）。改后：`Audit::new` 创建日志文件夹后用 `PinnedDirectory` 钉住它（Windows：不带 `FILE_SHARE_DELETE` 打开目录句柄并拒绝重解析点，文件夹及其祖先在句柄存续期间不能被重命名/替换；unix：拒绝符号链接并记录 dev/ino），写入器的每次（重）打开与轮换重开都在打开文件前后核对路径仍解析到被钉住的目录；核对失败或文件夹本身是联接/链接则不启动写入器（审计停用，网络丢失事实记录不受影响）。该文件夹是用户自己的 AppData，原本不跨越权限边界；这是加固。
- 新增/优化：无。
- 工程与测试：`a_reopen_refuses_a_folder_that_no_longer_names_the_pinned_directory`、`a_linked_folder_cannot_be_pinned`。
- 验证：见 PR 正文 `## Verification`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：核对与打开之间仍有极短的检查-使用间隙（目录句柄不允许 DELETE 共享，替换父目录本身不可能，只有祖先处联接被换走才可能被前后两次核对抓到）；TW-OpenAI-1（DHCPv4 许可的服务 SID 范围）未动，见 #602 与决定 097 / PR #1605。
