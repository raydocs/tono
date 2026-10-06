## 2026-10-06 · Windows 新外观细节打磨（0.0.75）
- 归属：`docs/SHIP_PLAN.md` 0.0.75。老板 2026-10-06：「uiux 细节打磨」。只动呈现，不动任何处理函数、保护、路由或原生代码。
- 来源：main `f26c57bd1` → 本 PR head，`claude/windows-ui-polish-20261006`；未合 main。
- 缺陷修复：
  - 首页详情面板（IHOME-12）：沿用的旧卡片各带一套内边距、线路按钮落到平台字体（Arial）、数字用等宽字体。现在三张卡都从同一条
    14px 边起排，用页面字体，数字用 tabular 数字对齐；两张小卡同行等高；当前线路的延迟与首页芯片、线路页一样写成 `83 ms`
    （原先是「极佳 · 83ms」式的旧词表）。
  - 活动页：单个应用超过 20 条连接时，原先只有一句「仅显示 20 条」，其余连接看不到也关不掉（#1411 F3）。现在给出「显示全部 N 条」，
    展开后每一行都有关闭按钮，仍走同一条按代际校验的关闭路径。未连接时不再显示「断开全部连接」一行（原先是一个永远禁用的按钮）。
  - 线路页：线路名里没有单独的城市词时，城市栏原先把线路名再写一遍；现在只写一次。
- 新增/优化：
  - 展开/收起（支持页三处、托盘、线路技术详情、首页步骤）统一成一个小箭头，展开时转 90°，不再用平台自带的三角；`prefers-reduced-motion`
    下不做过渡。
  - 支持页三个操作按钮同高（40px；原先中间的「复制给客服」是 32px）。
  - 线路页推荐卡的「?」改成 20px 圆环按钮，与旁边的标签垂直居中。
- 工程与测试：每条行为一条回归，均在旧源码上实跑为红（把 `dashboard.tsx`、`sea-activity.tsx`、`sea-lines.tsx` 退回 main 后 `4 failed | 69 passed`）：
  `Unable to find an element with the text: 83 ms`；`Unable to find … Show all 23`；`expected <button …> to be null`（未连接时的断开全部）；
  `Found multiple elements with the text: Singapore · Harbor`。纯 CSS 的四项（卡片对齐与字体、箭头、按钮同高、圆环）没有单测，
  在本机预览里核对：支持页三个按钮实测高度 `40,40,40`；「?」与标签的中心 `230.5 / 230.5`。新增文案键只有 `seaActivity.showAll`。
- 验证：MacBook，`vitest run` 全量 `Test Files 56 passed (56) / Tests 396 passed (396)`；typecheck `unchecked indexed access errors 79 (baseline 79)`；
  预览截图（920×600、中文，首页详情另看了英文）逐张看过：首页详情、线路、活动（展开 23 条）、支持、托盘。exact-head ci-gate 与评审见 PR。
- 候选/发布：仅源码，无新候选。并入下一轮 0.0.75 候选，由老板在真机上做 G1/G2。
- 剩余限制：未在 Windows/WebView2 真机验证（`:has()`、`:nth-last-child(… of …)` 需要 WebView2 ≥ 111，Windows 10/11 的常青运行时满足，
  但没有在真机上看过）。`biome` 对 `activity.test.tsx` 仍报两条本 PR 之前就有的问题（第 69 行 `useSemanticElements`、`serversMock` 一段的格式），
  未顺手改。TextSwap 240 ms 交叉淡入（#1393 codex:F1）与遥测简介文案（#1412 F2，文案由老板定）仍未做。
