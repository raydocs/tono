| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R681-old-helper-still-on | 旧版 `tono-service-install` 不认 `--start-registered` 退出 1 时，App 在 Restore internet 对话框按「保护仍开启」展示，而非「保护状态未确认」（`tono/connection/disconnect.rs:223`） | in-PR | [#684](https://github.com/raydocs/tono/pull/684)（来源 #681 评审 cb8d2f9c → 5a2e265e，codex:F2 → codex:F1，opus 降为 minor） | 中·推导 | 释放前就绪检查失败时错误以 `TONO_PROTECTION_UNCONFIRMED` 开头，前端映射到已有的 `tono.progress.protectionUnknownBody`（无法确认保护状态），不再说「保护仍开启」；覆盖就绪失败的所有原因。Service 拒绝或返回仍武装的释放失败仍报仍开启；未实机验证 |

停止规则：一轮修复后仍开放。
