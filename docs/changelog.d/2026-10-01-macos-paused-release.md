## 2026-10-01 · macOS paused states release the network instead of holding PF
- 归属：SHIP_PLAN §2 item 10；macOS App 保护离线后的暂停状态（HY2 三振、意外重启后不自动恢复、唤醒时已有暂停）。
- 来源：origin/main 8742da11；分支 fix/mac-pause-release-1287；源码 PR，未合 main。
- 缺陷修复：MAC-PAUSE-WATCHDOG-STALE-BLOCK（#1287）。三处暂停以前保留 PF、Core 已停、不排重连：非严格 Mac 断网约 30 秒，helper 看门狗释放后 UI 仍显示 Protected Offline。现在三处都走 #1285 的自动失败释放（`releaseAfterFailure`，保留 AI 拦截）：先显示「正在恢复原来的网络，AI 继续拦截」，释放落定为开放主机后显示「已回到原来的网络，AI 服务继续拦截。准备好后再连接」。仍不自动重连。暂定决定 044。
- 新增/优化：无。`releaseAfterProtectedDNSFailure` 改名为 `releaseAfterPausedFailure`（`failureReleaseNoticeTask`），行为不变。
- 工程与测试：新增 `PausedFailureReleaseTests.testRestartHoldReleasesWithAIHold`，断言只调用一次 `releaseAfterFailure`、先中间文案后最终文案、菜单栏不再是 blocked；旧代码不调用释放，断言失败（按代码推理，未实跑）。
- 验证：本机不运行 xcodebuild（所有者规则）；以 hosted CI macOS TonoTests 为准。
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：helper 拒绝（`.rejected`）暂停不能在无管理员提示时释放或读回状态，未改，拆到 #1305。浏览器 Secure DNS 释放（`AppState+Connect.swift` 健康检查）的文案不声称已恢复网络，未改。needs-hardware：真机 HY2 三振、意外重启、合盖唤醒下的释放与 AI 拦截。
