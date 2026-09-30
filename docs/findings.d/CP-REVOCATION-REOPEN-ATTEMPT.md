| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-REVOCATION-REOPEN-ATTEMPT | 控制面六处 `ON CONFLICT(tailscale_node_id) DO UPDATE` 重开撤除任务时不清 `last_attempt_at`，重开任务继承上次的旧尝试戳（且 `created_at` 重置为最新），在 `processRevocations` 的 `ORDER BY last_attempt_at, created_at, id LIMIT 40` 里排到最多 40 个持续失败任务之后，本轮不被尝试，设备重登记被 409 `REVOCATION_PENDING` 多挡一拍 | in-PR | [#758](https://github.com/raydocs/tono/pull/758) | 中·推导 | 修复：六处 SET 列表加 `last_attempt_at = 0`，与 0038 新任务默认一致。需部署控制面后生效；未在真实 Tailscale 验证；延迟有界（拍级轮换最终仍会轮到），非永久饿死 |

补充说明：发现路径：0038_revocation_retry_fairness 的公平排序只覆盖新任务与尝试打戳，未覆盖重开路径（代码推导，
`test/worker.test.ts` 回归测试去掉修复即红）。
