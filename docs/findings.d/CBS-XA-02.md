| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CBS-XA-02 | Exit-agent `save_state` renames the ledger without fsyncing the file or its directory, so a power loss can leave an empty or stale state file | in-PR | [#1233](https://github.com/raydocs/tono/issues/1233) | 低·推导（P3） | Needs a host crash between the write and writeback. Metering refuses on an empty ledger until an operator clears it; revocation still runs. Live node power-loss test not run |

`save_state` (`services/exit-agent/reconcile_and_report.py`) wrote `state.json.new` and renamed it without `fsync`, unlike the roster and hy2 auth-allow writers in the same file. It now fsyncs the file before the rename and the directory after it.
