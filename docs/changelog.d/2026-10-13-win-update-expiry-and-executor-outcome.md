## 2026-10-13 · Windows 更新记录过期后不再封住其他用户；执行器在消费后打不开 Service 也走结果路径
- 归属：SHIP_PLAN §2 item 10 范围外的 Windows Service 更新事务加固（issue #1293 的第 3、5 项）；分支 `claude/svc-pending-owner`；尚未合 main。
- 缺陷修复：
  - 第 3 项：`State::pending()` 不看 `expires_at`，用户 A 的 Prepare 若没走到 Install（A 的保护未验证，或 A 在 Install 前注销），其记录永远挡住用户 B 的释放、Connect 和更新 Disconnect，重启也不解。现在超过 48 小时回执有效期、未消费（已消费高水位仍低于该版本序号）且没有存活执行器的记录视为「惰性」：Service 用锁打开更新存储时归档为 `retired-<id>.json`（高水位与代数保留），只读的放开准入和 `/status` 的 pending 标志不写盘直接按未挂起处理。已消费的记录不受影响。决定见 [119](../decisions/119-2026-10-13-expired-unconsumed-update-stops-fencing.md)（provisional）。
  - 第 5 项：执行器在消费之后，`open_service` / `suppress_windows_service_recovery` / `stop_windows_service` 任一失败都会经 `?` 直接退出 `execute`，跳过 Uncertain 标记、网络放开和 SCM 恢复动作的还原。现在打开失败走 `settle_unopenable_service`（标 Uncertain、尝试放开，网络落定后才计一次失败的恢复），抑制或停止失败作为结果错误进入原有的结果路径。
- 新增/优化：无。
- 工程与测试：`update_status_cache_never_keeps_an_unproven_expiry_answer`（状态缓存：因回执过期得出的「无待决」在时钟失败或回退时作废；执行器在到期后仍存活则 30 秒后重新探测；针对新增函数，旧代码无法编译，不是红）、`update_release_admission_frees_an_expired_unconsumed_attempt`（旧代码红）、`update_expired_unconsumed_attempt_is_archived_and_a_consumed_one_never_is`、`update_unopenable_service_after_consumption_marks_uncertain_and_releases`（针对新增函数，旧代码无法编译，不是红）。未在本机运行 cargo。
- 验证：见 PR 正文；高风险（生命周期/特权路径），合并前需要独立 Codex 审查。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证；未过期的未消费记录仍会在 48 小时内挡住其他用户（决定 119 的代价）；第 1、2、4、6 项仍待所有者决定或实机回答。
