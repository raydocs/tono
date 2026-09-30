| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R684-update-release-reading | 待完成更新的 Disconnect 已释放 WFP，独立状态回读失败却绕过未确认处理并保留已保护缓存 | fixed(d092f80b) | [#684](https://github.com/raydocs/tono/pull/684)；评审 56d02a04 grok:F1，codex 确认 | 高·已确认 | 更新回读失败与仍武装但 live=false 的新读数都已进 main `d092f80b`（`027db93d`）。Windows CI [36670928625](https://github.com/raydocs/tono/actions/runs/36670928625) 与 [36670932440](https://github.com/raydocs/tono/actions/runs/36670932440) 在 `027db93d` 全绿。未做 Service IPC/WFP 故障注入，未实机。仍武装读数的显示问题另见 R684-armed-live-cache。建议级仍开放：`CORE_EXIT_UNREACHABLE` 会盖住未确认文案 |
