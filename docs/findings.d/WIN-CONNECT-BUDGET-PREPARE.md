| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CONNECT-BUDGET-PREPARE | 冷连接事务时钟漏计 PrepareCoreStart（65s）和住宅浏览器 Secure DNS（5s），最坏路径超过 240s 会误超时并拆掉尚未完成的连接 | in-PR | 待开 | 中·已确认 | 误超时仍走既有失败释放，不是永久断网。310s 只覆盖已记账的腿。needs-hardware |

`stages.rs` 在事务上等待 `tono_prepare_core_start`（服务端 `LIFECYCLE_TIMEOUT` 65s）。住宅目录还会先跑 `verify_residential_browser_dns`（5s）。旧表合计 208s、时钟 240s，两条腿都不在表里。回归：`connect_budget_covers_a_cold_first_connect`。
