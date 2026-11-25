## 2026-11-25 · macOS 诊断：登录与更新失败带上逐路径原因
- 归属：macOS 客户端，仅源码，无新候选；不是 G4 发布，也不改 SHIP_PLAN。
- 背景：两名用户（0.0.85、0.0.77）装不上更新，登录页「复制诊断」只有版本号和 `Auth stage: sign-in`，更新失败的逐路径原因只写 os_log，客户无处可发。
- 新增/优化：新增 `ConnectionFailureReport`（`Services/Diagnostics`），只记封闭词表的路径标签（`system_dns`/`direct`/`pinned`/`relay`）和失败类（`dns`/`connect`/`tls`/`timeout`/`other`/`skipped`），不含地址、主机、URL、错误原文、账号。登录页复制内容追加 macOS 版本、Protection 状态（armed 无隧道/有隧道/未 armed）和最近一次控制面各路径失败及距今分钟；更新元数据与更新包失败的弹窗在原句后追加 `Paths: …` 行，并记入同一报告。
- 测试：新增 `ConnectionFailureReportTests`（标签与类的白名单、IP/邮箱不外泄、skipped 与 userFacing 文案）；更新 `MacUsabilityRenderTests` 复制诊断用例（固定行用空报告，另断言报告行追加）。
- 未运行：本机不跑 xcodebuild，由托管 CI 验证；红测（旧代码失败）未在本机运行；未做真机验证。Windows 端诊断未检查。
- 未解决：两名用户的真实根因仍未证实，需要其平台、系统版本、弹窗原文和 traffic-audit.jsonl。
- 续记（同日）：用户截图登录页卡在 `Pending update needs recovery; no successor grant.`。出处是 helper `UpdateTransaction.reconcile` 的守卫（执行态不是 `replaced`、已 blocked、已请求断开，或仍是发起更新的同一进程同一次开机），App 启动时 `RuntimeCleanup.cleanupStaleRuntime` 把它原样抛到登录页，没有任何下一步。现在 reconcile 失败时改为先给出「检查更新 → Disconnect and Retry」的说明，再附 helper 原句；复制诊断多一行 `Pending update: execution …, phase …`（只取封闭词表）。未改 helper：`AppUpdater.disconnectRetriable` 对「consumed 且无 blocked/disconnect 标记」的尝试返回 false，此类卡住的客户在尝试过期（48h）前没有自助出口，这一点留作单独的 helper 修复。
