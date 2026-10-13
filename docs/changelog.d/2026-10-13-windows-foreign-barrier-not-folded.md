## 2026-10-13 · 第二个 Windows 用户的 App 不再把另一用户的全机拦截当成自己的保护
- 归属：SHIP_PLAN §2 item 10；Windows Service + App（`apps/windows`）。关联发现：`R4-WIN-MU-RESTORE-FOLD`（#1290）。
- 缺陷修复：用户 A 已连接（Locked、已验证、owner A），用户 B 快速切换进来启动 Tono：B 的启动恢复和 Protected Offline 重同步读到全机的 `kill_switch`，把 A 的拦截记成 B 自己的，显示 Protected Offline，恢复上网被拒，退出弹释放拒绝框。现在 Service 在 `/status` 聚合里报告 `kill_switch_held_by_another_user`（与 `authorize_write_for` 同一规则，owner 记录丢失时为 false），App 在读取快照的入口把它读成“我没有拦截”，所有折叠点（启动恢复、重同步、退出）同时生效。
- 决策：[113](../decisions/113-2026-10-13-windows-foreign-barrier-not-the-callers.md)（provisional）。
- 新增/优化：无。
- 工程与测试：`only_a_recorded_other_owner_makes_the_barrier_foreign_to_the_caller`（Service）、`another_users_barrier_reads_as_no_barrier_of_the_callers`、`the_callers_own_barrier_is_read_unchanged`（协议 crate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：双账号实机未验证；B 没有专门的“被另一用户占用”界面状态，只有点 Connect 后的 1014 文案。
