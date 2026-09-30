## 2026-09-30 · 运维控制台重做第 1 期：令牌、Panel 与图表组件
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 的一个控制台（Ops 2）工作；只动 `services/ops-console`。
  不是出货门，G4 冻结期间不合入。
- 来源：基线 `origin/main` d2363002 → 分支 `cursor/ops-console-foundation-d728`；未合 main。
  设计来源为原型 PR #737（`services/ops-console/prototype`）。
- 缺陷修复：浅色 `--muted-foreground` 由 0.58 调到 0.6 不透明度。原值在白底 11 px 小字上测得 4.48:1，
  低于 WCAG AA 4.5:1（axe `color-contrast`）；新值约 4.7:1，暗色不变。
- 新增/优化：
  - `src/styles/charts.css`：6 个类别系列色（避开红/琥珀/绿三种结论色）、网格/坐标轴/光标/悬停/焦点环/浮层阴影令牌，
    浅色与 `.dark` 各一套；探测未测的斜线纹理、骨架屏（尊重减少动画）、告警线标签描边。
  - `components/ops/Panel.tsx`：标题、说明、动作、正文，页脚写来源和"更新于"；超过 `staleAfterSec` 用 warn 色写
    "可能不是最新"；读取中/失败（可重试，`role=alert`）/无记录三种状态统一。
  - `components/ops/LineChart.tsx`：多系列、整数值刻度、按本地整点取时间刻度、阈值参考线、缺测断线（孤点画成点）、
    悬停与键盘（←/→、Shift 跳十列、Home/End、Esc）逐列读数，读数同时进 `aria-live`。
  - `components/ops/Bars.tsx`：堆叠柱、值轴、标签过密时隔列显示、同样的悬停/键盘读数。
  - `components/ops/ProbeStrip.tsx`：通/不通/未测三态，读屏只读计数。
  - `chart-scale.ts`（纯函数：线性映射、整刻度、字节按 1024 取整刻度、时间刻度、最近列、断线）、`use-chart.ts`、
    `ChartTip.tsx`；文案全部在 `src/copy/panel.ts`。
  - 保留：不改路由、不改任何现有页面或组件、不下线 Ops 1；`TimeSeries`/`Sparkline`/`HeatStrip`/`QuotaGauge` 原样保留，
    新组件不重复它们。暗色模式沿用已有 `ThemeProvider`，新令牌两套调色板齐全。
- 工程与测试：`chart-scale.test.ts` 7 个 `it`，每个行为一个。
- 验证（Linux 云端 VM，`services/ops-console`）：`npm run typecheck` 通过；`npm run lint` 通过；`npm test` 28 个文件
  320 个用例通过；`npm run build` 通过，初始 JS 196.3 KB gzip / 400，总 291.3 KB / 600，无文件超 400 行。
  临时演示页（未提交）在 1280 宽、亮/暗两种配色下截图，axe（wcag2a/aa、wcag21aa、best-practice）只剩演示页本身缺 h1。
  未执行：本机 `npx playwright test`（VM 未装 Playwright 自带浏览器，且像素基线与平台相关）；CI 以 `--ignore-snapshots` 跑功能断言。
- 候选/发布：无新包，仅源码。
- 剩余限制：新组件尚未接入任何页面（第 2 期起逐页替换）；`--muted-foreground` 微调后浅色像素基线可能需要在
  基线主机上重录。
