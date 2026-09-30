| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-RECORD-WEDGE | 无法解析的 `tono-service.core.json` 让启动对账永久失败，之后每次 Core 启动都被拒绝，直到记录被清除 | in-PR | [#775](https://github.com/raydocs/tono/pull/775) | 高·推导 | 需 hosted CI 与实机确认；恢复依赖隔离成功或下次 start 覆盖 |

`read_core_runtime_record` 解析失败即 `Err` 且不删文件，`reconcile_service_startup` 原样上抛，
`ensure_startup_reconciled` 把该确定性失败重放在每次 PrepareCoreStart/StartClash 上（StartClash 在
失败前已 arm WFP bootstrap）；记录只在 stop/exit 成功路径移除，所以一次损坏（断电、磁盘故障、或
下面 WIN-CORE-RECORD-SHARED-TMP 的混合提交）就卡死所有连接，直到一次走到 `stop_core` 的停止/断开
或手删。修复与 desired-state 同款：仅解析失败（NotFound 以外的 I/O 错误仍报错）改名
`<slug>.core.json.corrupt.<unix 秒>`，改名失败再尝试删除，告警不失败，读取按无记录处理，孤儿清扫
照常按镜像路径运行。回归：`runtime.rs` 的
`a_corrupt_core_runtime_record_is_quarantined_rather_than_refusing_forever`。not runtime-verified。
