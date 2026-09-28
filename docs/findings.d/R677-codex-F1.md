| ID | Problem | Status | Issue / PR | Severity | Remaining limitation |
|---|---|---|---|---|---|
| R677-codex-F1 | 8a9e6ebd/codex:F1 尚未完全修复：目录当前可写不能证明上次记录已持久化。目录权限可写但写入因 ENOSPC 或 I/O 错误失败时，recordConnectBootSession 仍吞掉错误并允许连接继续；panic 丢失 UserDefaults 后，此处返回 nil，下一次启动仍允许自动恢复。新增检查仅覆盖启动时目录仍不可写的子情形。 | open | #677 | minor | left open by the jev-route stop rule after 1 fix round(s) (review finding af108e1b/codex:F1) |
