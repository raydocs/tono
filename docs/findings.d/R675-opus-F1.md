| ID | Problem | Status | Issue / PR | Severity | Remaining limitation |
|---|---|---|---|---|---|
| R675-opus-F1 | 意外重启保持的提示和「等待用户操作」暂停只接在 `acceptCloudOnlyTransport(resumeProtection:)` 上（第 853-855 行）。Home-US 启动路径 `acceptTonoTransport` 也会请求自动连接，却只被 `attemptAutomaticConnect` 新增的 `!automaticResumeHeldAfterRestart` 门控 | open | #675 | minor | left open by the jev-route stop rule after 1 fix round(s) (review finding 9b7dd27e/opus:F1) |
