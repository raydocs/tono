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

2026-10-19 续（Codex 审查 `8cceb5415`：block）：
- major：AI Home 的放行规则与整机规则相同，切回整机时不会清理连接状态。AI Home 的放行改用独立标签
  （`tono-ai-home-loopback`、`tono-ai-home-tunnel`），任一方向切换都会被识别为撤回并完整清理状态。
- major：切换到 AI Home 的加载失败后，磁盘已记录新范围，睡眠或自愈会按 AI 范围渲染。现在新范围只在加载成功后写入
  （`scopeBeforeCommit`），失败时保存的仍是整机范围。
- minor：原生更新准备（`retainBootstrap`）重新 arm 时丢失范围。改为带上保存的 `aiHomeScoped`（`retainBootstrapRequest`）。
- 自测新增：两个方向的切换都完整清理、同范围重 arm 保留状态、加载前保存的范围、更新准备保持范围。

2026-10-19 续（Codex 审查 `82ec92407`：block）：
- major：整机切到 AI Home 时，PF 已装入只拦 AI 的规则，但随后的状态清理或验证失败，失败处理按普通重 arm 保留内核规则，
  整机保护实际被放宽。现在这种失败按收紧失败处理（`failedArmTightening`）：装入全封锁并进入受保护故障，
  装不上则停止 Core；错误提示写明是「AI Home protection」。加载未执行或被拒时，旧的整机规则仍在，处理不变。
- 自测新增：加载可能生效的切换算作收紧、未加载或被拒的不算、同范围与切回整机不算，以及经 `failedArm` 装入全封锁并锁定故障。

2026-10-19 续（Codex 审查 `685bd66f2`：block）：
- major：上述失败里，若全封锁也装不上（锚点、内存规则与主规则集三层都失败），原处理只停止 Core，内核可能仍是只拦 AI 的规则，
  而提示却说保护仍有效。此时 PF 已不接受规则，再装整机规则同样会失败；现在先加上不依赖 PF 的 AI 保持层
  （DNS 解析黑洞与黑洞路由，与退出时相同，下次 arm 成功后移除），再停止 Core；提示改为照实说明只确保 AI 流量被拦，其他流量可能未被拦截。
- 自测新增：全封锁失败时加上 AI 保持层、停止 Core 的错误码与提示文字；LAN 收紧失败与安装成功时不加。
