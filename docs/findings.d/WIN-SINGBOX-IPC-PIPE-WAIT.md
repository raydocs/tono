| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-IPC-PIPE-WAIT | Windows Service 启动核心后等 mihomo 的控制器命名管道，sing-box 不建这条管道，每次启动约 2 秒后被杀，sing-box 永远连不上且不回退 mihomo | in-PR | [#1195](https://github.com/raydocs/tono/issues/1195) | 高·推导 | 失败时回滚到普通网络、AI 仍拦，不断网；需在任何带 `sing-box.exe` 的包之前合入；实机启动未验证 |
