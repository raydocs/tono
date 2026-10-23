| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STALE-FAILURE-AUTH-PORT | Windows 过期连接失败在 adapter 读取返回后清空后继连接的认证隧道 fallback 端口 | fixed(3e8fa876a) | [#1725](https://github.com/raydocs/tono/pull/1725) | 中·已确认（受控回归） | 修正后同一回归行为 RED/GREEN、独立 R2 与精确交付 head CI 通过；初次 fixture 超时不计行为证据；仍待 Win10/11 实机与签名安装包 |

2026-10-23 Windows audit F2（原报告标识 `AUDIT-WIN-STALE-FAILURE-AUTH-PORT`）。
基线 `4fbf1e6a4b387c80498e14975595791591839ee6`，其中 Windows 源码等于冻结 main
`0465af8140d0fc91148fd3f356b8a9e819d71f76`；其后的 Android 回归不是本修复内容。

- 根因：`fail_connect` await adapter attribution 后无条件清 `auth_tunnel_port`，
  后续 `reconcile_failure` 的 stale 拒绝发生得太晚。A 暂停时 B 已发布 mixed port，
  A 返回仍可删掉 B 的最后控制面恢复通道；不代表 Core/WFP/DNS 被释放、TLS 放松或流量泄漏。
- 修复：移到 `record_connect_failure` 中，持有 state mutex 且通过 generation 检查后立即清零，
  与失败状态使用同一归属提交；中间无 await。显式 Disconnect/Restore、代次语义、TLS、Service 清理均不改。
- 回归源码提交：`662a792486e6ef7b482b2baf64586811b6769dbc`（保留原无条件清零；初次 hosted 仅 fixture 超时，**非行为 RED**）。
  单一 `late_failure_keeps_successor_auth_tunnel_port` 经生产共享 failure 入口，在 adapter await
  用 oneshot 暂停 A，退休 A 后发布 B，放行 A；断言 stale 返回、Service status/cleanup 均不得进入、
  B 的代次与 Connected/verified/controller 状态不变，并通过真实 transport 向 B 的指定 loopback
  mixed port 发送带 Bearer / `X-Tono-Path: tunnel` 的请求验证端口保留。当前代次对照仍必须清零。
- 测试只注入 OS attribution 与 Service 边界，不替换端口写入、代次锁或 transport fallback 实现。
  loopback HTTP 仅为测试观察边界，不改生产 TLS；修正后的监听端点读取完整 GET 请求后主动 EOF，
  覆盖 direct/alternate 地址，无 DNS、公网或真实 Service 依赖。
- 同伴检查：`failure_ownership_spans_status_cleanup_and_caller_abort` 保持原样，不能替代新入口回归。
- 初次 hosted 证据：RED run `39920445903` 与 fixed run `39920571463` 均编译后在 transport send 的
  10 秒 timeout unwrap 失败（`Elapsed(())`；各 771 passed / 1 failed）。这证明原 fixture 不适合 Windows，
  不证明产品旧行为失败或修复通过。独立 R1 无 major，指出 Service/cleanup panic 会被内层 spawn 吞成 false。
- 2026-10-23 测试修正 `a376644ade1f1a067284fa745b94d4de15ad13d7`：仅测试区；所有实际尝试的
  direct/alternate 端点改为监听、读完请求后无响应关闭；GET 按真实 transport 重试规则走到 B 的真实端口。
  stale await 后检查独立 atomic 进入标记，修掉吞 panic 的 oracle；保留真实端口发送与当前代次清零对照。
  没有调大超时、修改生产代码或增加第二个测试。相同补丁静态验证可应用到 RED 与 fixed，测试源码相同。
- 初次实现阶段已做：`git diff --check`、rustfmt 解析（不改写源码、不是编译）、隔离临时 index 补丁适用性检查。
  未做：修正测试的编译、native cargo/test/check/clippy/Tauri、hosted RED/GREEN 重跑、R1 后复审、
  Win10/11 真实设备资格。该阶段仍为 `open`；最终运行和当前合入状态见下文，未声称已发布。

最终运行证据（优先于上文实现阶段待验证说明）：修正 RED `08c9854de` 的
[run39922890390](https://github.com/raydocs/tono/actions/runs/39922890390) 确实失败于
`stale A cleared B's authenticated tunnel fallback port`，不是 fixture 超时。
修复 `96125d828` 的 [ci-gate39922905155](https://github.com/raydocs/tono/actions/runs/39922905155)
成功；原生 Tauri 库 772 passed，新增回归与原 ownership/caller-abort 同伴均通过。父任务读取原始日志。
独立 Sol/xhigh R2 覆盖 `96125d828d00c58a746c19059327f09c9a4d27a3`，R1 oracle 缺口已修，无新 finding。
后续仅追加本证据文档，产品树不变；仍非 Win10/11 实机、真实 Service/TLS 或签名安装包资格。

2026-10-23 合入状态复核：#1725 已合 main，合并提交 `3e8fa876a`；GitHub PR 状态、精确交付 head CI 及 main ancestry 已核对。此状态只确认源码合入；上文初次实现/夹具的待验证说明保留为历史，不替代后续运行证据，也不代表实机或客户发布通过。
