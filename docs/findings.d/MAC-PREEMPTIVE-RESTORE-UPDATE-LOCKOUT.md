| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PREEMPTIVE-RESTORE-UPDATE-LOCKOUT | preemptive 恢复网络未确认 pending update 已断开且 status 隐藏停止意图，导致连接/重试长期被锁 | in-PR | [#1740](https://github.com/raydocs/tono/pull/1740) | 高·已确认（P1，本机 XCTest RED） | 新增 helper root 故障测试待 CI；pending update + Restore 真机端到端未跑；不扩大安装中间态可退役范围 |

基线 origin/main `322f48c6f` 仍存在。RED `864b6bd25`：新 XCTest 1 项/1 失败；GREEN `b1c2ee773` 同源码更新相关窄套件 20 项、0 失败。

证据：`tooling/scripts/core-helper/ReleaseWorker.swift:236-241,275-283,567-610`，
`UpdateTransaction.swift:77-86`；`apps/macos/Tono/App/AppUpdater.swift:121-134`、`Core/HelperManager.swift:1392-1408`。
终态验证只认同一次 release 的 settled + restored PF/Core/DNS；写回再核对 attempt ID 与 initiating generation；保留原 receipt、execution、high-water 和恢复义务。
status 的 requested 只赋予明确重试动作，不是“已解除保护”证明；root 仍再次 Disconnect 并校验本机安装组件才允许 Retire。

R1 修正：曾仅看三组件而忽略 partial outcome，见 [MAC-PREEMPTIVE-PARTIAL-VERIFIED](MAC-PREEMPTIVE-PARTIAL-VERIFIED.md)。
`f91689a31` 加强 terminal restored 门，helper 4.52.67；root save 故障注入也已修正阶段，执行仍待 CI。
