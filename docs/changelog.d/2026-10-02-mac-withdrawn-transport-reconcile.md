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

### 2026-10-02 续记：已合 main
- 来源合入：#1350，merge commit `d7a43aa5`，PR 头 `bbec85b6`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37048070068 。红测试 `b716d89f`：run 37044078104（`macos / build` 只有 `testWithdrawnTransportReadsTheHelperAfterTheWatchdogWindow` 失败）；评审第 1 轮的红测试 `e3d727cc`：run 37046140188（只有新加的两条失败）。
- 独立评审：Codex `gpt-6.1-sol` high 两轮，记录在 https://github.com/raydocs/tono/pull/1350#issuecomment-5958839883 。第 1 轮（`d1a38965`）2 条按重大报的已修、1 条小问题修了一轮；第 2 轮（`29aad2bb`）0 重大、1 条小问题按规则记为未修（见 MAC-WITHDRAWN-TRANSPORT-STALE-BLOCK 的剩余限制）。PR 头比评审覆盖的 `29aad2bb` 只多一个纯文档提交。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证（needs-hardware）。
