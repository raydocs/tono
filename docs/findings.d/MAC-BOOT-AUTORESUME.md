| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-BOOT-AUTORESUME | macOS 启动时只要 helper 仍要求 PF 就自动重连；连接中意外重启（panic、断电）后每次登录都重复同一会话，若会话本身触发了重启就会形成循环 | in-PR | [#675](https://github.com/raydocs/tono/pull/675) | 中·推导 | 连接开始时记下 `kern.bootsessionuuid`（读不到记哨兵），完成释放时删除；`AppState.init` 比较记录与当前 boot，不同则启动恢复、重连循环、唤醒恢复都不自动连接，PF 保持，启动恢复时显示提示；同一次开机内崩溃仍自动恢复。UserDefaults 异步落盘，连接开始后几秒内的 panic 可能丢失记录；门控本身无测试；未实机验证 |

路径：`RuntimeCleanup.cleanupStaleRuntime` → `AccountSession.performRestore` → `cloudFallbackConsumer(shouldResumeProtection)` →
`AppState.acceptCloudOnlyTransport(resumeProtection:)` → `attemptAutomaticConnect()`。另外，未连接时网络变化会走
`scheduleProtectedReconnect(immediate: true)`，只要 `KillSwitchService.isArmed` 和 `isTonoReady`（缓存目录即可）成立，
可能早于启动恢复连上并把记录改成当前 boot，所以决策放在 `AppState.init`，自动路径在保持期间一律拒绝（#675 评审 opus:F1）；
读不到 boot session 时删除记录会让下一次意外重启照样自动连接，改记哨兵（codex:F2 = opus:F3）。与客户 panic 的因果未证实
（见 MAC-BOOT-TUNNEL-PASS）。
