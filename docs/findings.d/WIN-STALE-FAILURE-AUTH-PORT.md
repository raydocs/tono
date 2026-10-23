| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STALE-FAILURE-AUTH-PORT | Windows 过期连接失败在 adapter 读取返回后清空后继连接的认证隧道 fallback 端口 | open | 待开 | 中·推导 | 工作分支已有源码修复；尚未合 main、未编译，hosted Windows RED/GREEN 与独立高风险审查待补；无实机证据 |

2026-10-23 Windows audit F2（原报告标识 `AUDIT-WIN-STALE-FAILURE-AUTH-PORT`）。
基线 `4fbf1e6a4b387c80498e14975595791591839ee6`，其中 Windows 源码等于冻结 main
`0465af8140d0fc91148fd3f356b8a9e819d71f76`；其后的 Android 回归不是本修复内容。

- 根因：`fail_connect` await adapter attribution 后无条件清 `auth_tunnel_port`，
  后续 `reconcile_failure` 的 stale 拒绝发生得太晚。A 暂停时 B 已发布 mixed port，
  A 返回仍可删掉 B 的最后控制面恢复通道；不代表 Core/WFP/DNS 被释放、TLS 放松或流量泄漏。
- 修复：移到 `record_connect_failure` 中，持有 state mutex 且通过 generation 检查后立即清零，
  与失败状态使用同一归属提交；中间无 await。显式 Disconnect/Restore、代次语义、TLS、Service 清理均不改。
- 回归源码提交：`662a792486e6ef7b482b2baf64586811b6769dbc`（保留原无条件清零；**未执行 RED**）。
  单一 `late_failure_keeps_successor_auth_tunnel_port` 经生产共享 failure 入口，在 adapter await
  用 oneshot 暂停 A，退休 A 后发布 B，放行 A；断言 stale 返回、Service status/cleanup 均不得进入、
  B 的代次与 Connected/verified/controller 状态不变，并通过真实 transport 向 B 的指定 loopback
  mixed port 发送带 Bearer / `X-Tono-Path: tunnel` 的请求验证端口保留。当前代次对照仍必须清零。
- 测试只注入 OS attribution 与 Service 边界，不替换端口写入、代次锁或 transport fallback 实现。
  loopback HTTP 仅为测试观察边界，不改生产 TLS；非监听 socket 占住所需 direct/alternate 地址，
  无 DNS、公网或真实 Service 依赖。
- 同伴检查：`failure_ownership_spans_status_cleanup_and_caller_abort` 保持原样，不能替代新入口回归。
- 已做：`git diff --check` 与源码/类型接口静态核对。未做：所有 native cargo/test/check/clippy/Tauri、
  hosted CI、旧源码 RED、修复 GREEN、Win10/11 真实设备资格。状态仍为 `open`，不是已验证或已发布修复。
