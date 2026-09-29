| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R681-old-helper-still-on | 旧版 `tono-service-install` 不认 `--start-registered` 退出 1 时，App 在 Restore internet 对话框按「保护仍开启」展示，而非「保护状态未确认」（`tono/connection/disconnect.rs:223`） | open | #681 评审 cb8d2f9c → 5a2e265e（codex:F2 → codex:F1，opus 降为 minor） | 中·推导 | 只在 App 与已装 helper 版本错位时出现；Service 停止时持久 WFP block-all 仍在，展示方向偏保守；未改 |

停止规则：一轮修复后仍开放。
