## 2026-09-26 · Windows：旧状态快照不再覆盖退出登录；拒绝框「仍受保护」需两次同代读数
- 归属：G1（客户 0.0.73）；Windows App `tono/catalog_sync.rs`、`tono/connection/switch.rs`、`tono/connection/monitor.rs`、
  `feat/window.rs`。Service、安装器、协议未改。不变量：保护已解除时绝不显示已保护。
- 来源：基线 origin/main `f15e95a7`；红分支 `wip/win-stale-protected-red`（`a4d5885a`），修复分支
  `fix/win-stale-protected-status-20260926`（`0b865bdf`），[#656](https://github.com/raydocs/tono/pull/656)；未合 main。
- 缺陷修复：
  - H16-C-F3：目录同步提交、会话被拒挂起、切换回滚、监视器 kill switch 变化四处在锁内取 `status_of` 快照、解锁后才
    `emit_status`。退出登录在同一把锁内递增 `sign_in_generation` 并发布最终 SignedOut，但不拿 `lock_catalog_sync`，
    `abort_catalog_sync` 也取消不了同步段，旧的 Ready/Connected 快照可以在 SignedOut 之后写进 `STATUS_SNAPSHOT`，
    `tono_status` 与前端轮询一直读到它。现在四处都在解锁前发布，与其余约 30 处 `emit_status` 调用一致
    （`emit_status` 不拿状态锁，托盘刷新是异步派生）。
  - F520-1：Service `/status` 先取 kill switch 再取操作标记，释放恰在两次采样之间开始并结束时读成「屏障在线、无操作」，
    退出/重启拒绝框显示「仍受保护」。现在第一次读数判为 `Held` 时再读一次：两次 `snapshot_generation` 相同、都 wanted+live、
    都没有可撤除屏障的操作才为 `Held`；任一次看到释放类操作为 `ReleaseMayComplete`，其余为 `Unconfirmed`。文案只会变弱。
- 新增/优化：无。
- 工程与测试：目录同步的锁内提交抽成 `commit_fetched_catalog`（接收发布闭包），不需要 `AppHandle` 就能测顺序。
  新增 `#[tokio::test]` `catalog_sync_publishes_status_before_releasing_the_state_lock`（发布闭包里检查状态锁仍被持有）；
  `#[test]` `refusal_dialog_does_not_promise_protection_across_a_service_generation_change`（两次在线读数代际 4/6 →
  `Unconfirmed`，同代 → `Held`）。红分支只含测试和两个保持 main 行为的骨架（解锁后发布；只按第一次读数分类）。
- 验证：本地未跑 cargo/Tauri（MacBook 不是构建机）；以 hosted Windows CI（`windows-ci.yml` app-rust 任务）为准，
  run 编号与结果记在 #656。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机复现两处交错；Service 快照本身仍分两次采样（未改协议），拒绝框靠两次读数的代际比较收窄；`/status` 读不到时仍为「未确认」。
