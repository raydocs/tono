## 2026-10-02 · macOS：账户被拒后不再一直显示「仍在拦截」
- 归属：SHIP_PLAN §2 第 10 项；macOS App（`AppState.acceptTonoTransport`）。
- 来源：基线 `344aa3bb` → 分支 `fix/mac-withdrawn-transport-reconcile-20261002`，PR #1350；尚未合入 main。
- 缺陷修复：已连接时账户被拒或 401 被登出，Core 停、PF 留；约 30 秒后 helper 看门狗释放 PF，而 App 要等窗口激活才读回，
  账户页和菜单栏一直说 Kill Switch 仍在拦截。现在撤回传输 40 秒后读一次 helper，helper 确认已释放才清除。
  关联 MAC-WITHDRAWN-TRANSPORT-STALE-BLOCK。
- 新增/优化：无。PF、DNS、AI 拦截的行为都没有改；被拒后的约 30 秒断网仍在（是否立即放行是所有者决定，见 finding）。
  评审第 1 轮补两处：撤回时拦截已经存在（重连循环退避中，或加入了别的断开流程）也读一次，账户重新就绪后这次读取作废；
  helper 拒绝本 App 时账户页不再说「在拦截」，和菜单栏一样说「无法确认」。
- 工程与测试修正：回归 `testWithdrawnTransportReadsTheHelperAfterTheWatchdogWindow` 先单独推送为 `b716d89f`（红）；
  评审第 1 轮的两条回归（`testWithdrawalOverAnExistingBlockAlsoReadsTheHelper`、
  `testARejectedStatusReadDoesNotClaimABlockOnTheAccountGate`）先单独推送为 `e3d727cc`（红）。结果记在 PR。
- 验证：仅托管 CI（XCTest）；未在 Mac 实机上验证。仅源码，无新候选。
