| ID | Problem | Status | Issue / PR | Severity | Remaining limitation |
|---|---|---|---|---|---|
| R677-codex-F1 | 8a9e6ebd/codex:F1 尚未完全修复：目录当前可写不能证明上次记录已持久化。目录权限可写但写入因 ENOSPC 或 I/O 错误失败时，recordConnectBootSession 仍吞掉错误并允许连接继续；panic 丢失 UserDefaults 后，此处返回 nil，下一次启动仍允许自动恢复。新增检查仅覆盖启动时目录仍不可写的子情形。 | open | #677；修复 PR 待开 | minor | 续修：写失败向 Connect admission 传播，PF/Core 前拒绝启动，保留旧持久记录和现有保护状态，暂停自动重连；成功的显式重试才解除暂停。红/绿 hosted CI、独立 diff review、实机仍待完成；不能证明首次 panic 根因 |
