| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-ACK-FAIL-USAGE-FOLD | exit-agent 读完 Xray 计数后，roster ACK 失败（以及 `cache_error`、队列/上报时钟、清单无法证明）直接抛出，不像 hy2/停机/禁用路径那样 `keep_usage_locally`；若下一次成功折算前 Xray 重启，上次折算以来的用量被当作重启而免计 | fixed(b069ea5f0) | [#1784](https://github.com/raydocs/tono/pull/1784) | 中·已确认（红测：5,200 字节只计 1,200） | 改为折算不上报（决定 139，owner）；未在真实节点复现 |
