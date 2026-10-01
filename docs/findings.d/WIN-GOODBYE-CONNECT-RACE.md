| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-GOODBYE-CONNECT-RACE | Accepted idle owner-goodbye schedules shutdown after releasing its lifecycle lock, so a new connection during the 250 ms grace can be stopped | open | 待开 | 低·推导 | P2; requires concurrent quit/connect in a short window; deferred behind verified P1 repairs |

The acceptance check and delayed shutdown do not reserve a lifecycle shutdown state. Later shutdown does serialize with admitted work, but can then stop that newly admitted Core. No real-machine reproduction or source fix is claimed.
