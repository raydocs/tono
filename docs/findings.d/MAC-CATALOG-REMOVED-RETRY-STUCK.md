| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CATALOG-REMOVED-RETRY-STUCK | 「保护中，未连上」正在自动重试（或唤醒恢复）时所选出口被目录移除：没有家宽默认出口的普通账号被要求手动选择，重试循环随即结束，PF 继续全阻断且没有任何后续动作 | fixed(373e7316) | #1341 | 中·推导 | needs-hardware；只覆盖自动恢复仍在运行的状态，已暂停等待用户的状态不变；空闲未武装时仍要求手动选择；未在实机上触发目录移除 |

读码依据（main `f7279dd9`）：`installManagedExitCatalog` 的未连接分支只在 `routing.defaultProxy` 存在时才算已切换，
该字段只来自家宽绑定；否则置 `catalogSelectionRequiresChoice`，`scheduleProtectedReconnect` 的下一次尝试见到它就返回并结束循环，
唤醒恢复的 `connect()` 也被同一标志拒绝。同一条目录在连接进行中到达会走 `settleRemovedCatalogExit` 自动换到幸存出口，两种时序结果不同。

修复：自动恢复仍持有屏障时，有幸存出口就换过去并让恢复继续（PF 不变）；没有幸存出口就走既有的
`releaseOriginalNetwork`（决定 031：恢复普通网络，保留 AI 阻断）。
