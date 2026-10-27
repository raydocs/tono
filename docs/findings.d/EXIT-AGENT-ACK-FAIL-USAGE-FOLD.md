| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-ACK-FAIL-USAGE-FOLD | exit-agent 读完 Xray 计数后，roster ACK 失败（以及 `cache_error`、队列时钟、`source_id` 拒绝）直接抛出，不像 hy2/停机/禁用路径那样 `keep_usage_locally`；若下一次成功折算前 Xray 重启，上次折算以来的用量被当作重启而免计 | open | 待开 | 中·推导（读码，未复现） | 涉及计费；README 明写「ACK 失败在改动持久用量状态之前退出」，改法（ACK 失败也 `keep_usage_locally`）需所有者确认后单独 PR |
