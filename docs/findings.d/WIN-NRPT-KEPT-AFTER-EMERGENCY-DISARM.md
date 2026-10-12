| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-NRPT-KEPT-AFTER-EMERGENCY-DISARM | 非卸载的紧急解除（恢复网络 / `--emergency-disarm` / 释放服务清理）在适配器证明失败时移除 WFP 后，仍在 198.18.0.2 的网卡和 Encrypted DNS 钉住没有处理 | open | [#1590](https://github.com/raydocs/tono/pull/1590) | 高·推导 | 待实机：确认解除后系统解析走家宽 DNS；NRPT 规则本身在 main 上已由 BRICK-W4 清扫删除，此项补的是网卡重置和 DoH 还原 |

起草时以为 `restore_protected` 在适配器证明处失败会让 NRPT 留下；读代码发现 `emergency_disarm_with` 在 WFP 之后已调用 `remove_tono_resolver_rule_within`，NRPT 规则会被删。
真正没处理的是：仍指向 Tono 目标（198.18.0.2 / 回环）的网卡，和 `suppress_encrypted_dns` 关掉的 DoH。修复在 `dns/uninstall.rs` 的 `reset_redirected_adapters_after_failed_restore`：
WFP 移除之后，只把仍读作 Tono 目标的网卡重置为自动（DHCP），再调用 `restore_resolver_policy`；快照文件保留，原错误照旧返回。
