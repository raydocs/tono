## 2026-10-19 · macOS App：设置里可选「AI 家宽」模式（非默认）
- 归属：G2 macOS App（路由模式 / 连接流程 / 设置）；`apps/macos/Tono`。无辅助程序源码改动（依赖 helper 4.52.60）。
- 来源：分支 `feat/ai-home-app`，叠在 `feat/ai-home-pf`（#1693）上；未合 main。决定见 [130](../decisions/130-2026-10-19-desktop-ai-home-mode.md)。
- 新增：
  - 路由模式选项新增 `ai-home`（「AI 家宽」/ "AI Home"），默认仍是稳定模式。连接时按 AI Home 图构建配置
    （`DesktopRoutingModeAdmission.ownedGraph`），向辅助程序以 `ai-home` 绑定（非严格）。
  - 连接捕获模式时记录 `aiHomeRoutingSession`；该会话的每次 arm 都带 `aiHomeScoped`，回复未确认 AI 范围即报错
    （`aiHomeScopeUnconfirmed`），不会在整机规则下运行 AI Home。会话内重启 App 仍恢复该模式。
  - 云端失败时与三层分流一样先验证国内直连是否可用（AI 与海外仍阻断）。
  - 设置页只显示所选模式的说明：三层分流保留原两段说明，AI 家宽显示新说明（含识别范围的限制），稳定模式不再显示三层的说明。
    AI 家宽模式下「允许本地网络设备」开关停用，并说明该模式始终允许局域网。
- 缺陷修复：设置页在稳定模式下也显示三层分流的说明（客户反馈的「模式文字与所选模式不符」）。
- 工程与测试：新增 `AIHomeRoutingModeTests`（模式准入、arm 字段、会话记录与恢复、回复确认、图映射）；
  `RuntimeConfigTests` 选项列表更新；设置渲染夹具新增 AI 家宽。
- 验证：见 PR 验证评论。本机未编译，由托管 macOS CI 运行。
- 候选/发布：仅源码，非默认。改默认见 PR4（实机测试后）。
- 剩余限制：同决定 130；实机未验证 UDP、局域网、睡眠唤醒与 Core 退出窗口。

2026-10-19 续：
- AI 家宽会话里 arm 失败、helper 进入受保护故障时，App 不再按「无法阻止局域网设备」显示，也不再把它显示在局域网开关下：
  记为单独的 AI 家宽保护故障，同样保持连接并等用户操作，提示「Tono 无法应用 AI 家宽保护，因此 AI 流量保持拦截」。
- 测试：两个旧测试文件（`OptionalPolicyTests`、`PinRefreshKeepSessionTests`）的 arm 回复补上 `aiHomeScoped` 字段，修复编译；
  新增 AI 家宽故障归类测试。
