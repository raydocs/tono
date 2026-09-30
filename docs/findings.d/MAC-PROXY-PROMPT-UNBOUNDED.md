| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PROXY-PROMPT-UNBOUNDED | 系统代理的 administrator 授权弹窗被无期限等待，不理会对话框会把断开/恢复/退出全部挂死在 PrivilegedRuntimeCoordinator 上 | in-PR | 待开 | 中·推导 | 180 s 期限内 actor 仍被占住；osascript 被杀后凭据对话框的系统侧收尾未实机核对；`parseProxyInfo` 等只读子进程调用仍未设期限 |

`apps/macos/Tono/Core/SystemProxy.swift` 的 `runNetworkSetupWithPrivileges` 在未提权 `networksetup` 失败后
（非管理员用户、MDM 锁定代理设置）用 `osascript ... with administrator privileges` 重试，并以无期限
`waitUntilExit()` 等它。enable / turnOffProxy / restore / reapply 全部经由 `PrivilegedRuntimeCoordinator`
actor 串行走到这里，用户离开凭据对话框时 actor 被无限占住：Disconnect / Restore internet
（repairForRelease → stopCore → restoreDNS → disarm 逐跳同一 actor）永不完成，Quit 到 20 s 期限时 PF 仍
armed。`HelperManager.swift` ~332-349 早已为同一失败模式给安装弹窗加 180 s 界。

修复（分支 `glm/mac-proxy-prompt-bound`，PR 待开）：新增 `SystemProxy.waitForExit(_:timeout:)`（轮询 200 ms，
超时 SIGTERM、300 µs 后 SIGKILL，与 HelperManager 同一模式），提权等待 180 s 超时抛 `privilegesDenied`，
未提权 `runNetworkSetup` 15 s 超时抛 `commandFailed`；调用方失败路径未改。`AppState` Proxy Guard 加
`proxyReapplyInFlight` 防重入（原先每 10 s 的 tick 可在上一轮 reapply 未结束时继续入队）。回归：
`ProtectedDNSServiceSelectionTests.testBoundedWaitKillsSubprocessPastItsDeadline`（/bin/sleep 5 + 0.5 s）。
未实机。
