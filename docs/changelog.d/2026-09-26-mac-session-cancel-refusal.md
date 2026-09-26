## 2026-09-26 · macOS：令牌续期等待可取消、运行时启动复查拒绝、另一账户 helper 的安装拒绝原样上报
- 归属：G1；Issue #601 条目「535R-C-F2 residual」「535R-C-F3 residual」「#579 residual」。App `Services/TonoAPIClient.swift`、
  `Services/Account/AccountSession+Runtime.swift`、`Services/KillSwitchService.swift`；测试 `AccountSessionRequestTests.swift`、
  `HelperBoundAccountTests.swift`。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/mac-session-cancel-refusal-20260926-red`（`64c5f41e`），修复分支
  `fix/mac-session-cancel-refusal-20260926`，[#653](https://github.com/raydocs/tono/pull/653)；未合 main。
- 缺陷修复：
  - 535R-C-F2：共享的令牌续期是独立 Task，调用方被取消后仍等它结束。恢复网络/登出取消在途的目录请求后要排空它，
    于是要等到续期请求超时。改后：调用方经 `awaitRenewal` 等待，被取消即返回 `CancellationError`；续期本身照常跑完
    （服务器会轮换 refresh token，丢掉回答等于登出），槽位改由续期结束时释放，不再由先走的调用方释放，
    不会出现第二个续期拿着正在轮换的 token 发出。`performLogout` 对在途续期的排空不改：它要吊销最新的 token。
  - 535R-C-F3：`startCloudOnlyRuntimeThrowing` 记下 `entitlementRefusals`，每个 await 之后和失败路径上都复查；期间来的拒绝
    让这次启动作废（抛 `CancellationError`，`fail` 忽略它），`.suspended` 不再被 `.ready` 或 `.error` 覆盖。
    `activateCloudFallback` 在目录读取之后同样复查，不为被拒绝的会话选出口。
  - #579 残留：daemon 已注销、socket 已不在、安装文件和 allowed-uid 仍属账户 A 时，`KillSwitchService.installIfNeeded`
    把安装器的 `boundToAnotherUser` 包成 `installFailed`，恢复网络又显示「需要修复/批准管理员提示」。改后原样抛出，
    显示已有的、点名所属账户的文案；无新文案。`failureRequiresUserAction` 对两者本来都判为需用户处理，重连行为不变。
- 新增/优化：无。保护不放松：没有新的 PF 释放或登出路径，复查只让过期的启动停下。
- 工程与测试：每个行为一个 XCTest。`testACancelledReadStopsWaitingForItsTokenRenewal`（401 后续期被扣住，取消读取须在
  2 s 内返回，下一次读取用轮换后的 token）；`testARefusalDuringARuntimeStartIsNotOverwrittenByThatStart`（启动撤回描述符时
  收到拒绝，状态须仍为 `.suspended`）；`testTheInstallersRefusalStillNamesTheOwningAccount`（准备阶段抛
  `boundToAnotherUser("alice")`，`installIfNeeded` 须原样抛出）。红分支只含这三个测试，预期以断言失败
  （等待超时、`.ready` ≠ `.suspended`、得到 `installFailed`）。
- 验证：未在本地编译（MacBook 不是构建机）；以 PR 准确 head SHA 上的 macOS CI（`macos-26`）为准。红分支 CI 结果待补。
- 候选/发布：仅源码，无新候选。
- 剩余限制：登出仍会等在途续期结束再吊销（有意保留）。`cloudFallbackConsumer` 已发起的 Connect 若之后才遇到拒绝，
  仍由 `enterEntitlementBlock` 撤目录、停 Core 处理，未改。Home-US 路径（`startSidecar` 的 home 分支、运行时监视器自己的等待）未加复查。未实机。
