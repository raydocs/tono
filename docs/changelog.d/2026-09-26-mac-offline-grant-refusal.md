## 2026-09-26 · macOS：Tono 未验证也未离线准入的会话，Connect 一律拒绝
- 归属：G1（连接不得为服务端未接受的会话拨出口）；Issue #601 条目 R612-O5。App `Services/Account/OfflineGrant.swift`、
  `Services/Account/AccountSession+Auth.swift`、`Localizable.xcstrings`；测试 `TonoTests/AccountSessionRequestTests.swift`。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/mac-offline-grant-refusal-20260926-red`（`c4b2baa2`），修复分支
  `fix/mac-offline-grant-refusal-20260926`，[#652](https://github.com/raydocs/tono/pull/652)；未合 main。
- 缺陷修复：`OfflineGrantGate.connectRefusal` 在没有离线准入的授权时直接放行，把「不在离线模式」当成「在线已验证」。
  启动恢复连不上控制面、又没有匹配的离线授权时，账户落到 `error`，但启动时从缓存装入的目录仍在内存；网络变化触发的
  受保护重连（以及唤醒恢复、Retry、自动连接，都经同一个 Connect 入口）照样拨缓存出口。改后：gate 记下本进程里 Tono 是否
  接受过这个会话（任一 2xx 答复、`me()` 重新接受账户 `readmit()`、登录 `adoptNewIdentity()`）；既未在线接受、也未离线准入时
  Connect 被拒绝（新文案，带中文）。`settleRestoreFailure` 在离线准入判定前先清掉这一标记（`restoreUnverified()`），
  所以同一进程里之前验证过、之后重试恢复失败且无授权，也拒绝。有效授权的离线准入和吊销路径不变；PF/WFP 未改，无新放行路径。
- 新增/优化：无。产品取舍记入 [DECISIONS.md](../DECISIONS.md)（provisional）：账户验证完成前（含崩溃恢复启动的恢复期间）不拨缓存目录。
- 工程与测试：新增回归 `AccountSessionRequestTests.testUnreachableRestoreWithoutAGrantKeepsConnectRefused`：已登录会话、盘上无授权、
  控制面黑洞，`settleRestoreFailure` 落到 `.error` 后 `connectRefusal` 必须非 nil。红分支只含该测试，应以断言失败（main 返回 nil）。
- 验证：未在本地编译（MacBook 不是构建机）；以 macOS CI 为准。红分支 CI 已手动触发（run 36215655925），推送时尚无结果。
- 候选/发布：仅源码，无新候选。
- 剩余限制：恢复期间网络变化触发的受保护重连会显示「尚未验证」并按退避重试，直到恢复成功后自动连接；`error` 状态下 PF 保持，
  用户需在 Tono 可达后点 Retry。Home exit 路径 `me()` 与 `devices()` 并发，`devices()` 的 2xx 若晚于恢复失败到达，会重新放行（服务端确已接受会话）。
  未实机。Windows 是否有同类问题未核对。
