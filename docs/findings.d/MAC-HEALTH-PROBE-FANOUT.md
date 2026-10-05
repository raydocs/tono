| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HEALTH-PROBE-FANOUT | macOS 健康检查约每 10 秒同时启动多源 HTTPS 竞速和控制器探测，首选源会先赢时备源也已经启动 | open | 待开 | 低·推导 | 每天新连接数与封锁风险未证明；较小优化是只给健康路径的备源错峰，保留失败确认、节奏与恢复门槛（决策 043 保留健康 controller） |

Codex 核验 PARTIAL。WIN-EXIT-PROBE-INTERVAL 只决定 Windows 的 30 秒，不能作为 macOS 变更依据。记录于 #1386。
