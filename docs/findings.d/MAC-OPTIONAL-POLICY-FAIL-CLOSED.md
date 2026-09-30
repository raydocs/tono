| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-OPTIONAL-POLICY-FAIL-CLOSED | macOS 已连接后的可选 DIRECT 策略失败一律 preserve 断开，未碰 Core 的 PF arm 或写配置失败也会停掉正常连接并停在 bootstrap-only PF | in-PR | 待开 | 高·推导 | 替换前失败恢复原会话 PF 例外并保留连接；替换后失败或恢复失败保持原 preserve + protected reconnect。纯判定 XCTest 已加；未编译、未跑 XCTest、未实机；Needs real-hardware test (静杰 batch) |

2026-09-30：静态复核 main `c0a44053`；分支 `codex2/mac-optional-policy-fail-open`，PR 待开，未合 main。`/core/sync` 调用前设置替换标记；失败在此之前时按 Connect 的已连接 arm 参数恢复原 `activeDirectPolicy`，不提交新策略，保留会话。之后失败或 PF 恢复失败沿用 main 原有 `disconnect(releaseKillSwitch: false)` + `scheduleProtectedReconnect()`。
