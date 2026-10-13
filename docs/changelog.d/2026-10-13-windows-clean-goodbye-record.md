## 2026-10-13 · Windows：未连接退出后重开 App 不再停在“保护未知”；另一用户已登录时 goodbye 被拒
- 归属：SHIP_PLAN §2 item 10；Windows Service + App（`apps/windows`）。关联发现：`R5-WIN-RELAUNCH-STOPPED-SERVICE-UNKNOWN`（#1300）、`R4-WIN-MU-GOODBYE-OTHER-USER`（#1293 第 2 项）。
- 缺陷修复（#1300）：未连接退出后 Service 经 owner-goodbye 自停；不重启电脑直接重开 App 时，启动探测收不到应答，记为 Unknown→armed，界面停在 Protected Offline、不提供 Connect，下一次退出还为不存在的屏障弹 UAC。现在 Service 在接受 goodbye 并拆除 IPC 后写一条易失的“干净 goodbye”记录（`HKLM\SOFTWARE\<服务名>CleanGoodbye`，每次 Service 启动先删），App 在“收不到应答 + SCM 报告 Stopped + 记录存在”时读作已证明无屏障。崩溃、SCM 停止、缺记录仍是 Unknown→armed。决策 [114](../decisions/114-2026-10-13-windows-clean-goodbye-record.md)（provisional）。
- 缺陷修复（#1293 第 2 项）：另一个用户的未连接退出不再让 Service 在登录着的用户的空闲 App 下面自停：只要还有别的用户登录会话，goodbye 以 409 拒绝。决策 [115](../decisions/115-2026-10-13-windows-goodbye-refused-while-another-user-signed-in.md)（provisional）。#1293 第 1 项未改代码，见 finding `R4-WIN-MU-FAILED-CONNECT-BLOCKED`。
- 复核加严（Codex 复核 block）：记录只在拆除完整完成、没有 wanted/live、且 WFP 引擎报告无残留过滤器时才写；Service 启动必须先让旧记录不可读，做不到就不启动；App 读记录前后各验一次。
- 新增/优化：无。
- 工程与测试：`an_accepted_goodbye_leaves_the_clean_goodbye_record`、`a_stop_without_an_accepted_goodbye_leaves_no_record`、`goodbye_is_refused_while_another_user_is_signed_in`（Service）；`a_stopped_service_with_a_clean_goodbye_record_proves_no_barrier`、`a_stopped_service_without_a_clean_goodbye_record_stays_unknown`（App）；`an_accepted_goodbye_whose_teardown_did_not_complete_leaves_no_record`、`the_clean_goodbye_record_needs_every_piece_of_evidence`、`a_record_that_survives_the_delete_is_not_invalidated`、`a_record_gone_by_any_route_is_invalidated`、`a_record_deleted_while_scm_was_being_asked_is_not_a_clean_goodbye`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：易失注册表键的读写、SCM 状态、两个登录会话的行为均未在 Windows 实机验证；记录不是 IPC 字段，未改协议版本。
