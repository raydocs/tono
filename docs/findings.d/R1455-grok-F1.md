| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1455-grok-F1 | 从完整日志解析出的按天域名/进程汇总（`traffic_destination_daily`、`service_usage_daily`、`direct_candidate_daily`、`ops_traffic_segments`）没有指向 `users` 的外键，删号时不删，只靠 `retainTrafficDaily` 90 天过期 | open | [#1455](https://github.com/raydocs/tono/pull/1455) | 低·推导 | 文档（决策 076、diagnostics-privacy.md）已如实写明；删号清理未实现 |

复审 17af398d（Grok，Codex 验证 confirmed）。默认存储前这条路径只对开过窗口的设备生效，问题早已存在，默认存储放大了范围。
