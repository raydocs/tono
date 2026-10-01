| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R681-old-helper-still-on | 旧版 `tono-service-install` 不认 `--start-registered` 退出 1 时，App 在 Restore internet 对话框按「保护仍开启」展示，而非「保护状态未确认」（`tono/connection/disconnect.rs:223`） | fixed(d092f80b) | [#684](https://github.com/raydocs/tono/pull/684)（来源 #681 评审 cb8d2f9c → 5a2e265e，codex:F2 → codex:F1，opus 降为 minor） | 中·推导 | 释放前就绪检查失败、以及没有成功状态读数的释放错误，都以 `TONO_PROTECTION_UNCONFIRMED` 开头并清掉缓存读数；前端映射到已有的 `tono.progress.protectionUnknownBody`。源码已进 main `d092f80b`，exact-head Windows CI 与复审 5e0c86e8 已通过。仍武装但 live=false 的新读数另见 R684-armed-live-cache。连接失败后的自动释放若带 `CORE_EXIT_UNREACHABLE`，前端先显示节点不可达（建议级）；未实机验证 |

停止规则：一轮修复后仍开放。

续修（56d02a04 codex:F1，opus 降为 minor）：普通 Service 错误响应也可能发生在 WFP 已移除而回滚失败之后；
不能只凭错误声明保护仍开启。本地修正将所有没有成功状态读数的释放错误都映射为未确认并清掉缓存。
有效的仍武装读数后来由 `027db93d` 先写入新读数再返回原错误，见 R684-armed-live-cache。源码已进 main `d092f80b`。
