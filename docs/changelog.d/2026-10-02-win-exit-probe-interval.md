## 2026-10-02 · Windows：连接后每 30 秒探测一次出口（原 120 秒）
- 归属：SHIP_PLAN §2 第 10 项；Windows App（`tono/connection/monitor.rs`）。
- 来源：基线 `cc673eaa` → 分支 `fix/win-exit-probe-interval-20261002`，PR #1354；已合入 main（见文末续记）。
- 缺陷修复：出口在隧道还活着时失效，原先最长约 158 秒（按常量推）界面仍显示已连接；现在约 68 秒。所有者决定改成 30 秒。关联 WIN-EXIT-PROBE-INTERVAL。
- 新增/优化：无。探测内容、失败阈值、网络事件探测的冷却都不变。
- 工程与测试修正：回归 `a_silently_dead_exit_is_confirmed_within_about_a_minute` 先单独推送为 `f76188a1`（红），结果记在 PR。
- 验证：仅托管 CI（cargo test）；未在 Windows 实机上验证。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1354，merge commit `ac3039d5`，PR 头 `3a132100`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37065442400 。红测试 `f76188a1`：run 37063793566（`windows / app-rust` `650 passed; 1 failed`，只有 `a_silently_dead_exit_is_confirmed_within_about_a_minute` 失败）。
- 独立评审：普通风险（探测间隔常量），主会话核对 diff；未做独立评审。合并前 0 个未解决的评审线程。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
