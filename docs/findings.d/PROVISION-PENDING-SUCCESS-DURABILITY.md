| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PROVISION-PENDING-SUCCESS-DURABILITY | A crash before the final local provisioning record leaves a healthy remote transaction permanently pending and enrollment refused | fixed(156a2536f5dad0c56b809e9e4af9c7fbf5a3c75a) | [#1002](https://github.com/raydocs/tono/pull/1002) | 低·已确认（P2，Python 回归） | Operator recovery/enrollment only; no node outage claimed. Real SSH/VPS operation not performed. |

A retry now persists the normal completed record after fresh transaction-bound remote verification, including recovered public client metadata. It performs no duplicate provisioning mutation. Existing completed state and read-only verify stages remain unchanged.
