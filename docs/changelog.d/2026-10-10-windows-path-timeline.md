## 2026-10-10 · Windows 控制面路径切换进客户时间线（A19）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；Amp 待办 [A19](../ops/amp-backlog-2026-10-10.md)。
  `apps/windows`（`transport.rs`、`audit.rs`、`state.rs`、`telemetry.rs`）、`services/control-plane`（展平、ops 合同）、
  `services/ops-console`（客户时间线）。
- 来源：基线 main 2e4a7dfc → 分支 `amp/a19-windows-path-timeline`；PR 待开；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - Windows：一条控制面路径（`pinned` / `system_dns` / `relay` / `doh` / `alt_port` / `tunnel`）在确定没送达后，
    下一条路径开始时记审计事件 `controlPlanePathFail`（`from` 失败路径、`to` 下一条、`reason` 失败类
    `dns|connect|tls|timeout|other`、`elapsedMs` 该路径耗时），与 macOS `control_plane_path_failed` 对应。
    最后一条失败没有下一条，不记（同 macOS）。每次 `send` 用 task-local 记待报失败，请求之间不串。只有路径标签、类别和毫秒，
    不含地址、URL、主机名或账号字段。事件随周期时间线上传（`INCLUDE_KINDS`），时间线开关与账号归属规则不变：
    登录前或账号确认前的记录不上传。
  - 控制面：`FLATTEN_KINDS` 与 `CONNECTION_EVENT_KINDS` 加 `controlPlanePathFail`；该类事件展平时 `node` 为空（不是节点事实，
    不进节点页或节点测量小时）。`ConnectionEventDto` 加可选 `from` / `to` / `reason`（有值才出现，旧行 JSON 不变）。
    遥测入口原本就收这些键，不改。
  - 控制台：客户时间线显示「换路径」（灰色，不算失败也不算换节点），节点列为 `pinned → system_dns`，代码列为失败类，耗时列为该路径耗时。
    截图（fixture 临时加两行，未提交 fixture）：[customer-timeline.png](../ops/evidence/2026-10-10-windows-path-timeline/customer-timeline.png)。
- 工程与测试：`#[tokio::test] a_failed_path_is_reported_with_the_next_path_and_its_time`（Windows，钉住的本机端口拒绝、
  系统解析通 → 一条 pinned→system_dns/connect 事件与审计 JSON 形状）；`it('keeps a control-plane path failure with its paths
  and time, without a node')`（控制面 `test/ops-flatten.test.ts`）。
- 验证：见 PR 正文。Windows `cargo test` 未在本机跑（按 BUILD_AND_TEST 由托管 CI 跑）。
- 候选/发布：仅源码，无新候选；未部署。控制面先部署：旧控制面不展平这一类，事件留在原始窗口里，不报错。
- 新发现：[OPS-TIMELINE-CONNECT-CANCEL-KIND](../findings.d/OPS-TIMELINE-CONNECT-CANCEL-KIND.md)（`connectCancel` 不在合同词表，未修）。
- 剩余限制：macOS 的 `control_plane_path_failed` 仍只进本地审计（随网络日志上传），不进周期时间线，后台时间线只有 Windows 的；
  登录前的路径失败不进时间线（账号归属规则）。
