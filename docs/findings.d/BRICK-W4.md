| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W4 | Windows 卸载可以在 Tono 的 NRPT 全匹配规则（「.」→ 198.18.0.2）仍在时完成：阶梯第 3 档不删它，WFP 移除后的 DNS 错误一律标 `TONO_WFP_REMOVED` 走 exit 4 继续，超时的阶梯、重探降级和快路径也都不查；恢复网络快捷方式还叫用户重启，而重启不删注册表里的 NRPT 规则 | in-PR | [#680](https://github.com/raydocs/tono/pull/680) | 中·已确认（读码，Codex+Opus 交叉核实） | 修复：第 3 档也尝试恢复解析策略（仍报错）；紧急解除与卸载助手在报告可继续之前，都在有时限的独立线程里删除并读回 Tono 的 NRPT 键，删不掉就报新标记 `TONO_DNS_POLICY_REMAINS`（exit 3：卸载停下，产品文件保留）；助手的三个 runtime 不再等被放弃的阻塞调用；快捷方式与 exit 4 的文字改为给出设置路径，不再叫人重启。仍剩：W3 计划落地前 exit 3 仍删 Service（开始菜单快捷方式与重跑卸载程序会再清扫一次）；exit 4 时适配器 DNS 仍可能指向已停止的解析器；这是总账 W2 的续修；未实机验证（D4） |

来源：2026-09-28 砖机审计（origin/main `c0e7758e`），codex WINDOWS-2 = opus WIN-4，重开总账 W2。证据（行号为 `c0e7758e`）：
`service/src/core/dns/engine.rs:1513-1524,1588-1591`、`dns/mod.rs:2766-2769,2930-2937,2974-2990`、
`windows_kill_switch.rs:3150-3166`、`bin/uninstall_service.rs:136-146,332-341,451-456,579-599`、`installer.nsi:913-925`、
`bin/service.rs:193-203`。方向：PLAN-win-boot-uninstall 第 3 版 §1.4–1.5。

清扫只动 Tono 自己的键（`DnsPolicyConfig\{8f3c2b91-4a6e-4d17-9c1a-198018000002}`），键不存在算成功，删后一定读回；
只有卸载助手与提权的恢复 CLI 调用，Service 不调用。标记 `TONO_DNS_POLICY_REMAINS` 从不与 `TONO_WFP_REMOVED` 同时出现，
CLI 先判它。退出码仍是 0/2/3/4。
