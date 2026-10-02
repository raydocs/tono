## 2026-10-02 · Windows：被拒绝的退出请求不再留下「正在退出」标志
- 归属：SHIP_PLAN §2 第 10 项；Windows App（`feat/window.rs`、`lib.rs` 的 `ExitRequested`）。
- 来源：基线 `f7279dd9` → 分支 `fix/win-exit-flag-owner-1309`，PR #1340；尚未合入 main。
- 缺陷修复：Quit 被取消后会先清除退出标志，再恢复窗口并重新同步，这段时间它仍占着 Quit 的单飞槽。
  此时到来的 `ExitRequested` 先置位标志、再去申请槽并被拒绝，标志从此没有流程清除：前端通知和托盘
  刷新被静默，窗口退出入口不再响应。现在退出请求先取得槽，取得后才置位标志；取不到就什么都不改。
  关联 #1309（WIN-EXIT-FLAG-NO-OWNER）。
- 新增/优化：无。Quit 的释放、取消后的重新同步和托盘 Quit 的行为不变。
- 工程与测试修正：把槽的占用拆成 `claim`/`claim_raising`，`single_flight` 复用它；回归
  `an_exit_request_refused_by_a_quit_in_flight_does_not_raise_the_exiting_flag` 先随保持旧顺序的重构
  单独推送为 `c4c54fb6`（红），结果记在 PR。
- 验证：仅托管 CI；未在 Windows 实机上复现该时序。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1340，merge commit `ecdc3f96`，PR 头 `c10168c4`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37024372067 。
- 独立评审：Codex `gpt-6.1-sol`（high），第一轮无 major、两个 minor（一个已修，一个记在 finding），第二轮无发现；记录在 https://github.com/raydocs/tono/pull/1340#issuecomment-5955439545 。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
