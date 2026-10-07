| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W6 | Windows 原生更新替换后新 Service 始终没有就绪时不回滚，更新尝试一直停在 pending；48 小时收据过期后，对这个 pending 尝试的 Connect 被拒绝 | in-PR | [#1443](https://github.com/raydocs/tono/pull/1443) | 中·推导（读码，未核实到实机） | 执行器在启动/就绪失败后停掉新 Service、按计划恢复全部成员、记 RolledBack 并由回滚收尾重启前任；恢复连第一步都做不到（修复锁被占、停不下、store/owner 锁不可用）时仍保留旧死路；开机恢复本身不探测 Service 就绪 |

来源：2026-09-28 砖机审计推迟项，opus WIN-3。证据（行号为 `c0e7758e`）：`service/src/bin/install_service/update_executor.rs:507-540,343-351`、
`service/src/update_transaction.rs:267-272`、`service/src/core/update.rs:895-908`。
