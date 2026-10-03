| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-MONTH-RECON-SNAPSHOT | Newly closed months omit reconciliation from summary_json, so later asset changes alter the frozen report | fixed(ee764dde) | hunt/sol-cp-month-reconciliation-snapshot | 低·已确认 (P2) | Existing closed rows are not rewritten; legacy/oversized snapshots still compute reconciliation live. |

The reader already prefers snapshot.reconciliation; the writer only stored customers/nodes. Include the reconciliation under the existing UTF-8 byte cap. Regression closes a month with one missing node bill, retires that node, and verifies the closed report remains unchanged.
