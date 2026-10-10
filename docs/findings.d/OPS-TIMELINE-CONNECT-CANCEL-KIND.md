| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-TIMELINE-CONNECT-CANCEL-KIND | `connectCancel` 在 `FLATTEN_KINDS` 里却不在 ops 合同 `CONNECTION_EVENT_KINDS` 和控制台 `eventWord` 里：客户时间线这一行结果列为空，严格合同模式（`OPS_CONTRACT_STRICT=1`）下连接列表会断言失败 | open | 待开 | 低·推导 | 修法：两处词表与控制台词各加 `connectCancel`（如「取消连接」，灰色）；A19 发现，未在该 PR 修，单列一个 PR |
