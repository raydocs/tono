| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-REFUSAL-CLAIMS-UNCHANGED | 拒绝文案只要匹配 another owner 就说网络保护没有变化，但 Prepare 之前 App 可能已经清过连接 | in-PR | fix/t7-update-prep | 中·已确认 | 去掉这半句。`another owner` 仍停住。未上真机 |

Service 在 Prepare 报 `active session belongs to another owner` 时，App 已经做过 `clear_for_update` 和 `invalidate_connection`。技术详情仍保留原文。
