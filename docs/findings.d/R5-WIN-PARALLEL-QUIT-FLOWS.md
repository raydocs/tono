| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R5-WIN-PARALLEL-QUIT-FLOWS | Windows 退出入口没有单飞：窗口退出还在等释放时，托盘退出再起一条退出流程；释放超时后两边都可能弹确认框，一个「留在 App」清除退出标志并恢复同步，另一个继续清理并退出 | in-PR | [#1299](https://github.com/raydocs/tono/pull/1299) | 中·推导（Codex 审查 #1299 时提出，读码） | `feat::quit_or_resync()` 对整个「退出→取消后重同步」加单飞，进行中的第二次调用直接返回。`restart_app` 与开发用退出入口不经过此守卫。实机未验证 |
