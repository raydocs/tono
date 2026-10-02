## 2026-10-02 · Windows：出口探测失败后下一拍复测
- 归属：SHIP_PLAN §2 第 10 项；Windows App 已连接会话的健康监控（`connection/monitor.rs`、`connection_health.rs`）。
- 来源：基线 `373e7316` → 分支 `fix/win-exit-probe-confirm`，PR #1343；尚未合入 main。
- 缺陷修复：周期出口探测第一次失败后，第二个样本原先要等下一个 120 秒周期，出口静默失效时界面保持
  「已连接」而流量不通最长约四分半钟。现在有未确认的失败时下一拍（2 秒后）就复测；复测成功则恢复
  120 秒周期。关联 WIN-EXIT-PROBE-SLOW-CONFIRM。
- 新增/优化：无。探测周期、失败阈值、第二次失败后的就地证明和释放/重连路径都不变。
- 工程与测试修正：把探测时机抽成 `exit_probe_due`；回归 `a_failed_exit_probe_is_confirmed_on_the_next_tick`
  先随保持旧行为的抽取单独推送为 `cff4cb35`（红），结果记在 PR。
- 验证：仅托管 CI；未在 Windows 实机上让出口静默失效。仅源码，无新候选。
