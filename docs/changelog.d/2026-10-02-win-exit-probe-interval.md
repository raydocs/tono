## 2026-10-02 · Windows：连接后每 30 秒探测一次出口（原 120 秒）
- 归属：SHIP_PLAN §2 第 10 项；Windows App（`tono/connection/monitor.rs`）。
- 来源：基线 `cc673eaa` → 分支 `fix/win-exit-probe-interval-20261002`，PR #1354；尚未合入 main。
- 缺陷修复：出口在隧道还活着时失效，原先最长约 158 秒（按常量推）界面仍显示已连接；现在约 68 秒。所有者决定改成 30 秒。关联 WIN-EXIT-PROBE-INTERVAL。
- 新增/优化：无。探测内容、失败阈值、网络事件探测的冷却都不变。
- 工程与测试修正：回归 `a_silently_dead_exit_is_confirmed_within_about_a_minute` 先单独推送为 `f76188a1`（红），结果记在 PR。
- 验证：仅托管 CI（cargo test）；未在 Windows 实机上验证。仅源码，无新候选。
