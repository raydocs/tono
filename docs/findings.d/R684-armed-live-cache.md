| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R684-armed-live-cache | 释放拿到仍武装但 live=false 的新读数时不替换缓存，界面仍按旧的 live=true 显示已保护 | fixed(d092f80b) | [#684](https://github.com/raydocs/tono/pull/684) 复审 4cd55317 grok:F1、opus:F1、codex:F1；修复 `027db93d`；跟进复审 5e0c86e8 | 高·已确认 | `release_still_armed` 先把新读数写入 `kill_switch` 再返回原来的武装错误；FSM 的阻断/重试锁存不变，WFP 行为不变。回归 `an_armed_release_reading_with_live_false_replaces_cached_live_true` 在 Windows CI [36670932440](https://github.com/raydocs/tono/actions/runs/36670932440) 通过（app-rust 561 通过）。未做 Service IPC 故障注入，未实机 |

来源：复审 4cd55317 在 `f6f80dc7` 上确认。无成功读数的失败已经报未确认；这一条是成功读数仍武装、但 `live=false`，旧缓存却是 `live=true`。
