| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-GATE-GHOST-TUN | 每次停止 Core 都是硬杀，WinTUN 设备变为「不存在」而 Windows 保留名为 `Tono` 的接口行；手动安装门禁只按名字匹配，连接过再断开或卸载的机器每次手动重装都被 87 拒绝；同名遗留行还可能让 WFP 锁把隧道许可键到遗留 LUID，或在别名解析后读行得到 `ERROR_FILE_NOT_FOUND` 时永久失败，首次连接失败 | fixed(ccbc50a8) | #676 | 高·推导（读码与 Microsoft 文档，未实机读到 OperStatus） | 修复：门禁只对 Windows 报告为存在（OperStatus ≠ 6）的 `Tono` 行拒绝 87，否则在 install-gate.log 的 OK 行记一条说明；经 `tunnel_absent` 的三个更新路径调用方（`update.rs:164`、`update.rs:442`、`windows_kill_switch.rs:1024`）继承同一规则；WFP 锁把不存在的行或别名解析后的 `ERROR_FILE_NOT_FOUND` 当作可重试的「did not resolve to a LUID」，其他读行失败仍永久拒绝。遗留接口行有意保留，不删除任何设备。未验证：A5（遗留行是否读作 6；否则门禁照旧拒绝）、A9（用户禁用的适配器同样被忽略，那次连接失败）、A12（wintun 能否改名不存在的接口；不能时新适配器成 `Tono 1`，那次连接超时，下次成功）；计划 §4.6 实机通过前不得声称客户已修复 |

来源：2026-09-27 客户现场（安装程序报 87，设备管理器里只列出一个灰色的「Meta Tunnel」）；WIN-GATE-OPAQUE 的 7411 客户
可能同因（未确认）。方向与证据：计划 PLAN-stale-adapter 第 3 版（Jev be13d4a6；计划评审 cb50f375、d1837131、1e546b82）。回归测试
`core::update::tests::update_manual_gate_ignores_a_not_present_tono_interface`、
`core::wfp_model::tests::a_gone_or_not_present_tunnel_row_waits_for_the_new_adapter`。评审 1e546b82/codex:F1、F2 两条 minor
按设计保留，记在 [changelog](../changelog.d/2026-09-27-win-ghost-tono-adapter.md) 的剩余限制里。
