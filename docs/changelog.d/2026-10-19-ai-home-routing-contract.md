## 2026-10-19 · macOS：新增 AI Home 路由图（AI 走家宽，其余直连），辅助程序可接受
- 归属：G2 macOS 路由 / 辅助程序准入；`tooling/scripts/sing-box`、`apps/macos/Tono/Core`、`tooling/scripts/core-helper`，
  helper 4.52.58 → 4.52.59。
- 来源：`origin/main` `fb67c3c22` → 分支 `feat/ai-home-contract`；未合 main。决定见 [130](../decisions/130-2026-10-19-desktop-ai-home-mode.md)。
- 新增：
  - `tooling/scripts/sing-box/ai-home-template.json`：从三层分流图派生，标签改为 `Tono-AIHome-*`。AI 规则、家宽出站、
    家宽 DNS 与三层完全相同；AI 的 UDP/ICMP 拒绝；名单内海外与视频走云；其余（含 UDP、局域网、未收录站点）直连，最终出口为直连。
  - `sync-routing-domains.mjs` 同时生成 `ThreeTierRoutingContract.aiHomeTemplateJSON`；`--check` 覆盖两份图。
  - `ThreeTierRoutingContract`：`Variant`、`isAIHomeRuntime`、`routingMode(of:)`、`admitsAIHome`（仅完整结构相等才接受）。
    `buildThreeTierSingBoxRuntime(variant: .aiHome)`。
  - 辅助程序：`ownedRuntimeConfigIsSafe` 按图的标签判断模式；`/session/bind-runtime` 接受 `ai-home`，以非严格方式绑定
    （不记录严格意图），且不能替换已绑定的严格三层会话。同时带两套标签的配置被拒绝。
- 缺陷修复：无。保留：稳定模式与三层分流的生成字节不变。
- 工程与测试：helper `--self-test` 与 `--release-self-test` 新增 AI Home 准入、AI 规则改直连被拒、混合标签被拒、非严格绑定与
  不可降级；`SingBoxConfigTests` 新增 AI Home 快照（AI 规则与 DNS 等同三层、AI UDP 拒绝、无兜底拒绝、`sing-box check`）；
  `routing-domains-sync` 测试覆盖第二份图。
- 验证：见 PR 验证评论。本机未编译（MacBook 不跑 swiftc），由托管 macOS CI 构建并运行。
- 候选/发布：仅源码，App 尚未提供该模式（PR2 补 AI 范围的 PF 保持，PR3 接入设置，PR4 实机测试后改默认）。
- 剩余限制：只识别名单内的 AI 域名与 Anthropic 网段；经 DoH、ECH、共享 CDN 或未收录 IP 访问的 AI 会走直连。

2026-10-19 续（Codex 审查 `cd2e1b524`：approve-with-fixes）：
- minor：`CoreManager.bindRuntime` 判断模式时没有像准入和启动那样折叠键名，`DNS`/`OUTBOUNDS` 大写键的 AI Home 图可被声明为
  stable 绑定。改为同一份折叠后的对象（`CoreManager.foldedRuntime`），`--self-test` 新增大小写键回归。
