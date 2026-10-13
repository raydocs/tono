| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-317 | 流量策略 revision 在签名字节之外，重放的旧签名策略可钉住客户端 | open | [#317](https://github.com/raydocs/tono/issues/317)，[#342](https://github.com/raydocs/tono/pull/342)，[#472](https://github.com/raydocs/tono/pull/472)，[#473](https://github.com/raydocs/tono/pull/473)，[#474](https://github.com/raydocs/tono/pull/474) | 中·推导 | 客户端与 Worker 两半已合；生产未开 `TRAFFIC_POLICY_EMBED_REVISION`。开关是发布步骤，记在 [RELEASE_LINES](../RELEASE_LINES.md#customer-publish-g4)：客户源上的客户端都能校验内嵌 revision 之后再开 |

2026-10-13 关闭 issue #317（所有者同意按记录关闭），剩余开关以本行和 RELEASE_LINES 为准。
