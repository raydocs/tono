## 2026-09-26 · Windows：启动恢复在 me() 之前发布已存屏障，迟到的 me() 不再把已释放的屏障写回
- 归属：G1（Windows 启动会话恢复）；Windows App `tono/commands/restore.rs` 的 `restore_account_with`。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/win-restore-late-me-20260926-red`（`4b0e7b99`），修复分支
  `fix/win-restore-late-me-20260926`，[#651](https://github.com/raydocs/tono/pull/651)（Part of [#602](https://github.com/raydocs/tono/issues/602)）；未合 main。
- 缺陷修复：
  - H16-O-F7：持有 refresh token 的冷启动恢复先向 Service 探测屏障，却把探测结果压到 `me()` 返回之后才写进状态机，
    `me()` 进行期间托盘 flyout 显示 Standby 并提供 Connect。改后：进入 Restoring 时，在同一把锁里先
    `apply_stored_protection` 再发布状态，`me()` 期间即显示被拦截并提供「恢复网络」。没有新增释放路径。
  - F515-1（#602 评论项，Codex 发现、Opus 核实）：超时、成功、失败三个 `me()` 分支都会再次应用启动时的探测结果，
    只以 `sign_in_generation` 把关，而「恢复网络」不改它。`me()` 期间用户已释放屏障时，迟到的结果把旧读数写回，
    界面在已放开的机器上显示「网络已拦截」，直到 30 秒一次的 Service 轮询纠正。改后：这条路径只在 `me()` 之前应用一次，
    三个分支（含 `settle_failed_restore`）不再重放旧读数；之后的释放或 Service 重读是更新的事实。WFP 从未因此放松。
- 新增/优化：无。StoreError、NoToken 两条路径不变（应用与判断在同一把锁内，没有等待窗口）。
- 工程与测试：新增两个 `#[tokio::test]`（`barrier_before_me_tests`）：
  `cold_restore_applies_the_stored_barrier_before_me`（`me()` 挂起期间状态机须已武装并显示被拦截）与
  `late_me_answer_does_not_reapply_a_released_barrier`（`me()` 挂起期间走 `disconnect()` 的步骤和真实 `coordinate_release`，
  注入已证实的 Service 释放，`me()` 迟到成功后状态机须仍未武装、`kill_switch` 为释放后的读数）。两者在 main 上都应按断言失败，无需骨架。
- 验证：未在本地编译或运行（MacBook 不是构建机）；以 `windows-ci`（`windows-2025`）为准，尚未出结果。
- 候选/发布：仅源码，无新候选。
- 剩余限制：用户在 `me()` 期间释放后，恢复流程其余步骤（目录/策略同步、`schedule_startup_resume_if_proven`）照旧执行，本修复未改；未实机验证。
- 续记 2026-09-26（审查 opus:F1，已确认小项）：红分支 CI 两个测试均按断言失败，PR CI 通过。审查指出受保护更新恢复（`update_recovery` 为 Connected）时，
  恢复末尾无条件派生 `connection::connect()`，只以 `sign_in_generation` 把关；`me()` 期间用户完成的「恢复网络」会被一次完整重连
  （重新武装 WFP 并连接）推翻，本 PR 让 `me()` 期间显示被拦截并提供「恢复网络」后更容易走到。改后：恢复开始时记下
  `connect_generation`，新增 `update_recovery_connect_allowed`，只有登录代、连接代都未变且没有释放在进行时才自动连接；
  否则跳过并记日志，保留用户选择的已释放状态（更严格，拿不准就不自动连接）。新增一个 `#[tokio::test]`
  `restore_internet_during_restore_skips_update_recovery_connect`：未动的恢复允许，走 `disconnect()` 的步骤并完成释放后拒绝；
  红骨架（保留原判定）提交 `b7e50b39` 上应按断言失败。H16-O-F7 改回总账原行（in-PR，#651），删除其分片。未在本地编译。
  剩余：判定与派生的 `connect()` 真正准入之间仍有极短窗口，未把连接代传入 `connect()`（需改 `connection.rs`，超出本单元）。
