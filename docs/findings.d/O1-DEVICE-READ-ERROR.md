| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-DEVICE-READ-ERROR | A failed device standing read appears as no actions and a closed diagnostics window | in-PR | [#968](https://github.com/raydocs/tono/pull/968) | 低·已确认 | P2; ui-review, no auto-merge |

`services/ops-console/src/pages/customer/Devices.tsx:58,69,208`: either action-history or diagnostics-window GET can fail. The error resource loses its message at the card boundary; null standing is treated as empty history and the operator can issue an open-window PUT even when the existing window is unknown. Preserve the read error and disable the log toggle until standing exists. Independent queue actions and revocation remain available.
