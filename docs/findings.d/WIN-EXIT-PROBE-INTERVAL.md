| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-EXIT-PROBE-INTERVAL | Windows 连接后每 120 秒才探测一次出口：出口在隧道还活着时失效（节点宕机、线路被掐），界面最长约两分半仍显示已连接但什么都打不开；macOS 每 10 秒探测一次 | in-PR | [#1354](https://github.com/raydocs/tono/pull/1354) | 中·推导 | 间隔改为 30 秒（所有者 2026-10-02 决定）。没有实机验证。探测次数变成原来的 4 倍，每次是一条受保护 DNS 查询加一个小 HTTPS 请求 |

依据（`main` `cc673eaa`）：`apps/windows/app/src-tauri/src/tono/connection/monitor.rs` 的 `EXIT_PROBE_INTERVAL` 是 120 秒；探测腿要连续失败 `HEALTH_FAILURE_THRESHOLD`（2）次才判失效，单次证明的预算是 `TUN_DATA_PLANE_TIMEOUT`（18 秒）。按常量推：最坏约 120 + 2 + 2×18 = 158 秒，改后约 30 + 2 + 36 = 68 秒；之后还要过一次就地证明才拆隧道。这是量级，不是墙钟上界。线上数据（2026-10-02 读生产 `connection_events`，近 7 天）：一位用户在同一出口上有 112 次「all 3 protected TUN probes failed」。回归 `a_silently_dead_exit_is_confirmed_within_about_a_minute`。和 WIN-EXIT-PROBE-SLOW-CONFIRM（#1343，失败后下一拍复测）是同一条链路上的两段。
