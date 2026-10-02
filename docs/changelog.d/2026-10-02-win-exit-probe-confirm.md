## 2026-10-02 · Windows：出口探测失败后下一拍复测
- 归属：SHIP_PLAN §2 第 10 项；Windows App 已连接会话的健康监控（`connection/monitor.rs`、`connection_health.rs`）。
- 来源：基线 `373e7316` → 分支 `fix/win-exit-probe-confirm`，PR #1343；尚未合入 main。
- 缺陷修复：周期出口探测第一次失败后，第二个样本原先要等下一个 120 秒周期，出口静默失效时界面保持
  「已连接」而流量不通约四分钟以上。现在有未确认的失败时下一监控拍（名义 2 秒）就复测；复测成功则
  恢复 120 秒周期。关联 WIN-EXIT-PROBE-SLOW-CONFIRM。
- 新增/优化：无。探测周期、失败阈值、第二次失败后的就地证明和释放/重连路径都不变。行为变化：恰好
  撞上周期探测的短暂上游故障，如果复测和就地证明也都失败，现在会拆隧道，以前会被跳过。
- 工程与测试修正：把探测时机抽成 `exit_probe_due`；回归 `a_failed_exit_probe_is_confirmed_on_the_next_tick`
  先随保持旧行为的抽取单独推送为 `cff4cb35`（红），结果记在 PR。
- 验证：仅托管 CI；未在 Windows 实机上让出口静默失效。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1343，merge commit `3e2d603a`，PR 头 `728afc94`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37029134595 。
- 独立评审：Codex `gpt-6.1-sol`（high），无 major；两处既有竞争未改，记在 finding；记录在 https://github.com/raydocs/tono/pull/1343#issuecomment-5955951813 。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
