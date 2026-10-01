## 2026-09-30 · Windows 首页新增「今天的 AI 流量」卡片（v1，仅本机）
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 9 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。只影响 Windows 首页，在「当前节点」卡片下方新增一张卡片。
- 来源：基线 main `d2363002` → 分支 `cursor/windows-ai-traffic-card-b9f5`；未合 main。草稿：`tono.json` 和 `dashboard.test.tsx` 与 #706 重叠。
- 缺陷修复：无。
- 新增/优化：卡片按 Claude / ChatGPT / Cursor / Grok 列出今天走家宽的流量，下面是近 7 天的小柱状图。标题和副标题写明「家宽上的流量，不是剩余额度」。数据只来自首页已经订阅的核心连接列表（`useConnectionData`），只统计 `classifyActivityRoute` 判为 `home` 的连接，每条连接只按增量计数。不读取任何服务商 token，不请求任何服务商，也不上传。计数存在 localStorage，键为 `tono.aiTraffic.v1:` 加账号邮箱 SHA-256 的前 16 位十六进制，换账号互不可见；只保留 7 天。没有登录账号，或者未连接且 7 天内没有数据时，卡片不显示。新增文案键 `tono.dashboard.aiTraffic.*`（中英文），并重新生成了 i18n 类型。
- 工程与测试：新增 `src/tono-ui/ai-traffic.ts`（纯函数累加、裁剪、读写）和 `AiTrafficCard.tsx`；新增 `ai-traffic.test.ts` 一个用例（只计家宽、重放不重复计、增长只加增量）；`dashboard.test.tsx` mock 掉这张卡片。桌面预览新增 `tonoAccount` fixture 和 `scenario=ai`（带家宽路由的 Claude / ChatGPT 连接，并预置前 6 天数据）。
- 验证：`pnpm exec vitest run src/tono-ui/ai-traffic.test.ts src/pages/tono/dashboard.test.tsx` 通过（2 个文件，23 个测试）；`eslint --max-warnings=0`、`tsc --noEmit` 通过。前后截图见 PR（截图时连接进度 fixture 临时改为无失败步骤，未提交）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：只在首页打开时累计，卡片注释写明了这一点；放到布局层常驻订阅要把 2000+ 条连接一直留在内存里，所以没有这样做。暂只有 Windows，macOS 要改 `DashboardView.swift`（#706 的文件）。Claude Desktop 和 Claude CLI 在 Windows 上都是 Claude.exe，合为一行。界面重启而核心没有重启时，同一条连接可能被重复计数一次。
