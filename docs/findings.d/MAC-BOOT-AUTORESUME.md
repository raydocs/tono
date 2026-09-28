| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-BOOT-AUTORESUME | macOS 启动时只要 helper 仍要求 PF 就自动重连；连接中意外重启（panic、断电）后每次登录都重复同一会话，若会话本身触发了重启就会形成循环 | in-PR | 分支 `fix/macos-boot-panic-loop-20260927`（PR 待开） | 中·推导 | 连接开始时记下 `kern.bootsessionuuid`，完成释放时删除；启动时记录与当前不同则不自动连接、PF 保持、显示提示，同一次开机内崩溃仍自动恢复。UserDefaults 异步落盘，连接开始后几秒内的 panic 可能丢失记录；Home-US（`acceptTonoTransport`）路径未覆盖；未实机验证 |

路径：`RuntimeCleanup.cleanupStaleRuntime` → `AccountSession.performRestore` → `cloudFallbackConsumer(shouldResumeProtection)` →
`AppState.acceptCloudOnlyTransport(resumeProtection:)` → `attemptAutomaticConnect()`。另外，未连接时网络变化会走
`scheduleProtectedReconnect(immediate: true)`，所以保护用的是已有的「等待用户操作」暂停（网络变化和唤醒恢复都遵守），不是只清
`autoConnectRequested`。与客户 panic 的因果未证实（见 MAC-BOOT-TUNNEL-PASS）。
