## 2026-10-13 · Windows 更新执行器在停 Service 之前死掉后自动放开，并在启动执行器前冲刷会话
- 归属：SHIP_PLAN §2 item 10 之外的 #1055 P2 清单；Windows App（`apps/windows/app` `commands/update.rs`）。决策 120（provisional）。
- 来源：基线 `358fd9da1`；分支 `claude/win-update-executor-watch`；PR 待开；尚未合 main。
- 缺陷修复：`R2UA-F2`：Install 记 `Launching` 后无人监督执行器，执行器在停 Service 之前退出（被杀、`repair already running`、镜像/绑定拒绝、回执过期、暂存组件已变）会让 Core 停着、bootstrap 一直 Blocked，只能手动 Restore internet。现在 App 在 Install 之后轮询 Status（2 s 一次，120 s 宽限）：仍是 `Launching`（或回到 `Staged`）即判定执行器丢失，走与 Prepare 失败相同的自动释放（放开普通流量、保留 AI 阻断；显式 strict 由 Service 拒绝并保持 Blocked）。读不到 Status 或已进入 `Consumed` 之后不算丢失。`WIN-UPDATE-TOKEN-FLUSH`：执行器用 TerminateProcess 结束 App，退出冲刷不会运行，轮换后的 refresh token 若 vault 写入失败就随进程丢失；现在在 Install 之前再冲刷一次会话写入器（带重试），仍失败只记日志不阻止更新。
- 新增/优化：无。
- 工程与测试：三条回归：`an_executor_that_never_consumes_the_install_is_lost`、`a_consumed_install_or_a_stopped_service_is_not_a_lost_executor`、`the_session_is_flushed_before_the_executor_starts`；红检查用旧行为桩（编译通过、断言失败），见 PR 正文。
- 验证：见 PR 的 Verification。未在本机运行 cargo。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无实机验证（AV 杀执行器等）。执行器极慢、超过 120 s 才消费时，释放已先记录 disconnect，迟到的消费会被拒绝（更新失败而非在放开后继续）；执行器先取得事务锁时，释放要等它做完。持续失败的 vault 写入仍会让轮换后的 token 随进程结束丢失（只是不再绕过重试）。`R3REGW-RECOVERY-PUBLICATION-FLOOR` 在 main 已修（afb98c5d）；`R3REGW-ROLLBACK-DOUBLE-HOLD` 属 AI hold 语义决策，未改。
