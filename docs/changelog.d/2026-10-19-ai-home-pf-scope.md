## 2026-10-19 · macOS 辅助程序：AI Home 的 PF 只拦 AI 网段，不再整机拦截
- 归属：G2 macOS 辅助程序（Kill Switch / PF）；`tooling/scripts/core-helper`，helper 4.52.59 → 4.52.60。
- 来源：`origin/main` `82a58122f` → 分支 `feat/ai-home-pf`；未合 main。决定见 [130](../decisions/130-2026-10-19-desktop-ai-home-mode.md)，
  前置 PR #1692（AI Home 路由图）。
- 新增：
  - arm 请求新增可选 `aiHomeScoped`（只接受 JSON 布尔，缺省为关）。开启时 PF 锚点只有 lo0 与 TUN 放行，
    再加一条 `tono-ai-home`：在 TUN 以外的所有接口丢弃 AI Home 图中走家宽的网段（现为 Anthropic `160.79.104.0/21`）。
    没有整机兜底拦截，普通流量不受过滤。网段直接从 AI Home 图读取（`ThreeTierRoutingContract.aiHomeHeldCIDRs`）。
  - 该标记写入保存的状态（仅开启时写入，其他状态文件字节不变），自愈与睡眠/唤醒屏障保持 AI 范围；严格意图优先。
    arm 回复回显实际渲染的 `aiHomeScoped`。
  - PF 生效检查同时识别整机兜底与 `tono-ai-home` 拦截，释放检查会把它当作 Tono 的残留拦截。
- 缺陷修复：无。保留：稳定模式与三层分流的 PF 规则不变；退出、Core 退出与「恢复正常网络」的释放路径不变（退出与故障保留 AI 保持层）。
- 工程与测试：`--self-test` 新增 AI Home 规则逐行对比、严格优先、整机模式不受影响、仅开启时持久化、自愈与睡眠屏障保持范围、
  字段只收布尔、锚点识别；`--lifecycle-self-test`（root）把规则装入测试锚点，核对内核显示的文本。
- 验证：见 PR 验证评论。本机未编译，由托管 macOS CI 构建并以 root 运行。
- 候选/发布：仅源码。App 尚未发送该字段（PR3 接入）。
- 剩余限制：只拦 IPv4 的 Anthropic 网段；共享 CDN 上的其他 AI 服务、DoH、ECH 与 IPv6 不在此层覆盖（见决定 130）。
