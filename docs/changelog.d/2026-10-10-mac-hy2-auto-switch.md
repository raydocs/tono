## 2026-10-10 · macOS：Reality 连续失败后自动换到同一节点的 hy2 块（A17 macOS）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A17（D1-C）macOS 半边，Windows 另一个 PR。影响 macOS 连接 FSM 与目录解析。
- 来源：基线 `main` ed00fe84；分支 `amp/a17-hy2-auto-switch-macos`，PR 见本条目所在 PR；未合 main。依赖 A18（#1492）在控制面下发 `hy2AutoSwitch`；#1492 合入前字段缺失，客户端按 `false`，行为与现在相同。
- 缺陷修复：无。
- 新增/优化：`TonoExitCatalogResponse` 读可选 `hy2AutoSwitch`（缺失或非布尔按 `false`，不拒目录），每次 200 都读，包括安装结果「未变化」的那次；目录被拒按 `false`。新 `Hy2AutoSwitch`：同一 Reality 块连续 3 次 `CORE_EXIT_UNREACHABLE` 后，下一次连接在内存里把选中块换成同一节点的 ` · hy2` 块（基名 + 后缀、密码等于 Reality UUID、内核可用、非商家拦 UDP）；自动 hy2 真正 Connected 后按节点记住 24 h（账户分开持久化），过期回 Reality；自动 hy2 失败则忘掉并 30 min 内不再自动试。开关变 `false`、hy2 块离开目录、用户手选该节点都会清掉记忆。保存的选择始终是用户的 Reality 块。PF 按拨号节点放行，与手选 hy2 同一路径，无新放行，helper 协议不变。暂定[决定 081](../decisions/081-2026-10-10-hy2-auto-switch-macos-client.md)；[transport-hy2.md](../ops/transport-hy2.md#a17-macos-客户端同节点自动换到-hy2) 新增一节。
- 工程与测试：新 XCTest `Hy2AutoSwitchTests`（2 条：开关真时 3 次失败后拨同节点 hy2、开关假时留在 Reality；记忆需要新的 200、24 h 过期、hy2 块离开目录即清）。
- 验证：Linux orb 不能跑 Swift；XCTest 与完整 macOS 套件（连接 FSM 动了）由托管 CI 跑，结果见 PR 的 `ci-gate`。未执行：真机（需 #1492 部署并给内部账户开开关，再在 Reality 被阻断的网络上验证）。
- 候选/发布：仅源码，无新包；未部署。
- 剩余限制：失败放行后的无武装重连梯子仍先做 Reality 的 TCP 证明，TCP 完全不通时不会自己连到第 3 次，需要用户再点连接。三网 hy2 握手证明（SHIP_PLAN §2.6）仍未做，服务端开关默认全关。
