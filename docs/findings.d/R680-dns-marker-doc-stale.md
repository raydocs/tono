| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R680-dns-marker-doc-stale | opus:F2 修正之后，Windows Service 几处文档注释与代码不符：仍说 `TONO_DNS_POLICY_REMAINS` 本身挡住卸载且从不与 `TONO_WFP_REMOVED` 同时出现、WFP 残留是唯一的阻塞条件；实际两个标记会同时出现，挡住卸载的是 `with_resolver_rule_proof` 的再次清扫 | open | [#680](https://github.com/raydocs/tono/pull/680)（评审修正轮留下） | 低·已确认 | 尚无修复；只是注释，行为与测试（T4、T5、T6）已按新语义 |

来源：PR #680 复评 opus:F2。证据（行号为 `83b0c623`）：
- `apps/windows/service/src/core/dns/mod.rs:1208-1211`（`DNS_RESOLVER_POLICY_REMAINS_PREFIX` 的注释：挡住卸载、从不与
  `WFP_REMOVED_CONTINUE_PREFIX` 同行）；
- `apps/windows/service/src/core/windows_kill_switch.rs:3003-3009`（紧急解除的不变式注释：WFP 删后每个 DNS 结果都带继续标记，
  只有 WFP 仍在才挡）；
- `apps/windows/service/src/bin/uninstall_service.rs:26-28` 与 `:73-74`（「WFP 屏障可能仍在」是唯一阻塞条件）。

实际：清扫失败时报文以 `TONO_DNS_POLICY_REMAINS` 开头，后面原样跟着 DNS 结果（可能含 `TONO_WFP_REMOVED` 等继续标记）；恢复 CLI
先判这个标记；卸载助手按其后的 DNS 结果分类，由 `with_resolver_rule_proof` 再清扫一次，规则未证明删除就 exit 3。按停止规则记录，未再修。
