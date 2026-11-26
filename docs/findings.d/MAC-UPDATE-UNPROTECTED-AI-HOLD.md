| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-UNPROTECTED-AI-HOLD | macOS `UpdateExecutor.run()` 失败捕获无条件调用 `releaseInstalledBlock()` 与 `SelectiveFailOpenInstaller.applyBestEffort()`，未保护或已「恢复网络」的 Mac 更新失败时被写入 `retain-ai`、`/etc/resolver/*` 黑洞与 Anthropic 黑洞路由（违反决策 125） | in-PR | fix/macos-update-quit-and-ai-hold | 高·网络 | 待 hosted `macos / privileged-tests` 与真机复测；不改严格模式或已武装会话的 AI 拦截保留 |

与 Windows `release_applying_narrow_if_owed`（决策 125 / #1293 第 4 项）对齐：在 `UpdateExecutor.aiHoldOwed` 与 `releaseAfterFailure` 中按武装状态、PF 状态与 `selectiveRecoveryDisposition` 判定是否欠 AI 拦截。
