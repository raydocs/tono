## 2026-10-10 · macOS 登录经 Tono 自有中继绕过 Cloudflare 不可达路径
- 归属：SHIP_PLAN §2 item 10（「连不上且无下一手」例外，与 Windows 侧 [2026-10-10-win-api-relay](2026-10-10-win-api-relay.md)
  同根因；所有者 2026-10-10 「继续做 macos 客户端」）；macOS 客户端
  `apps/macos/Tono/Services/{ControlPlanePath,TonoAPIClient}.swift`。服务端同一节点，不改。
- 来源：基线 6c4ea8971（main，含 #1462）→ 分支 `fix/mac-api-relay-20261010`；PR 待开；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) 的 mac 侧。原行为：系统 DNS 路径与固定 IP
  路径（`ControlPlanePath`）都在 TLS 前失败后直接报传输错误。改后：两条路径都确证未送达（走 `shouldRetry` 同一判定，
  POST 只在未建连时）失败时，再试编译进客户端的中继 `ControlPlanePath.apiRelays`（`api.afk.ccwu.cc` →
  179.253.233.220:2053，连接预算 5 s），复用固定 IP 客户端（Network.framework，SNI 为 API 主机名，默认证书校验，
  无代理、不跟随重定向）；中继应答后本进程后续请求先走中继，首位尝试失败/取消/正文失败则清除偏好。
  审计事件 `control_plane_path_failed` 的 `path`/`next_path` 增加 `relay`。
- 新增/优化：`PinnedConnection` 支持非 443 端口；`PinnedControlPlaneExchange.send` 带路径标签、端点列表与连接预算。
  中继不进入 `KillSwitchService.configuredBootstrapPins`（PF 放行表），armed 时中继被 PF 拦截，不放宽 fail-closed。
  决策 [077](../decisions/077-2026-10-10-api-relay-outside-cloudflare.md)。
- 工程与测试修正：`TonoAPIClient.init` 新增 `relayPath:` 注入；一个回归
  `testDeadSystemAndPinnedPathsHandTheRequestToTheRelayOnceAndKeepIt`（登录 POST，系统 DNS 与固定 IP 都在建连前失败，
  中继应答且被记住，第二次请求不再付两条死路径）。
- 验证：本机不跑 xcodebuild；红测提交与绿提交均由 hosted macOS CI 运行：待记。
- 候选：仅源码，无新候选；0.0.75 不含此修复。
- 未做：中继第二节点；实机（移动线路）验证待用户更新后反馈。
