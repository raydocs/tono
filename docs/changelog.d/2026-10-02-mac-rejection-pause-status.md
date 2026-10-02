## 2026-10-02 · macOS：helper 拒绝当前 App 时不再声称「已拦住直连」
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) §2 第 10 项。macOS App（状态展示）。
- 来源：[#1305](https://github.com/raydocs/tono/issues/1305)，分支 `fix/mac-rejection-pause-status`，[#1335](https://github.com/raydocs/tono/pull/1335)。未合 main。
- 缺陷修复：helper 对当前这份 Tono 回 403 时，App 暂停自动重试并保留 Protected Offline。这时 Core 已停，helper 的看门狗约 30 秒后会放开 PF（保留 AI 拦截），而 App 的每个请求都被拒绝，读不到这次释放。菜单栏、首页状态和顶部横幅继续显示「Protected Offline」「Direct traffic is blocked」。现在这个状态下三处都显示「Protection unknown」，横幅说明 Tono 无法确认直连是否仍被拦截；「修复并重新连接」和「恢复正常网络」不变。
- 新增/优化：无。
- 工程与测试：`AppState.helperRejectedStatusRead`（随暂停结束或 helper 第一次回应而清除）和 `isProtectionBlockUnreadable`；新增一条 XCTest；字符串表新增一条中文。没有改 helper、PF 或连接流程。
- 验证：见 PR。XCTest 只在 hosted macOS CI 运行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：App 仍读不到 PF 的真实状态，也不会自动释放（释放需要管理员重装 helper，不在没有用户操作时弹出）。诊断快照的 stage 仍是 Protected Offline。未实机验证（`needs-hardware`）。

### 2026-10-02 续记：已合 main
- 来源合入：#1335，merge commit `08a433a6`，PR 头 `34c57781`。该头的 CI 结果见 PR。
- 普通风险改动：主会话核对差异并在 hosted CI 上跑了对应测试，没有独立评审。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
