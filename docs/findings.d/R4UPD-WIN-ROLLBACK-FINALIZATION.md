| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4UPD-WIN-ROLLBACK-FINALIZATION | Interrupted Windows rollback skips its selective network and Service finalization because RolledBack is excluded from recovery | in-PR | [#1081](https://github.com/raydocs/tono/issues/1081); branch `hunt/sol-r4fwa-rollback-finalize` | 低·已确认（P2，Linux 回归） | Real Store interruption regression failed before/passed after. Native executor/SCM/WFP behavior requires Windows CI and hardware. Old-component proof failures retain evidence; cleanup/native persistence failures remain retryable. |
