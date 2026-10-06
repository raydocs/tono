## 2026-10-06 · Windows 新外观细节打磨（0.0.75）
- 归属：`docs/SHIP_PLAN.md` 0.0.75。老板 2026-10-06：「uiux 细节打磨」。只动呈现，不动任何处理函数、保护、路由或原生代码。
- 来源：main `f26c57bd1` → 本 PR head，`claude/windows-ui-polish-20261006`；未合 main。
- 缺陷修复：
  - 首页详情面板（IHOME-12）：沿用的旧卡片各带一套内边距、线路按钮落到平台字体（Arial）、数字用等宽字体。现在三张卡都从同一条
    14px 边起排，用页面字体，数字用 tabular 数字对齐；两张小卡同行等高；当前线路的延迟与首页芯片、线路页一样写成 `83 ms`
    （原先沿用旧词表：TCP 读数写成 `83ms`，出口读数写成秒，83 ms 会显示为 `0.1 秒`）。
  - 活动页：单个应用超过 20 条连接时，原先只有一句「仅显示 20 条」，其余连接看不到也关不掉（#1411 F3）。现在给出「显示全部 N 条」，
    展开后每一行都有关闭按钮，仍走同一条按代际校验的关闭路径。应用收起后回到前 20 条，展开过的上百行不再留在页面里随每次刷新重算。未连接时不再显示「断开全部连接」一行（原先是一个永远禁用的按钮）。
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
- 评审（jev-route `5f90855c`，Opus 5.5，Codex 核验，PASSED，无拦截项）后的一轮修复：F1 上面的旧文案描述改正；F2 关闭路径的回归改为关闭「显示全部」之后才出现的第 23 条（先断言它在展开前不存在）；F3（建议）收起即回到 20 条，新增一条回归，去掉 `onToggle` 后实跑为红：`to have a length of 20 but got 23`。
- 验证：MacBook，`vitest run` 全量 `Test Files 56 passed (56) / Tests 397 passed (397)`；typecheck `unchecked indexed access errors 79 (baseline 79)`；
  预览截图（920×600、中文，首页详情另看了英文）逐张看过：首页详情、线路、活动（展开 23 条）、支持、托盘。exact-head ci-gate 与评审见 PR。
- 候选/发布：仅源码，无新候选。并入下一轮 0.0.75 候选，由老板在真机上做 G1/G2。
- 剩余限制：未在 Windows/WebView2 真机验证（`:has()`、`:nth-last-child(… of …)` 需要 WebView2 ≥ 111，Windows 10/11 的常青运行时满足，
  但没有在真机上看过）。`biome` 对 `activity.test.tsx` 仍报两条本 PR 之前就有的问题（第 69 行 `useSemanticElements`、`serversMock` 一段的格式），
  未顺手改。TextSwap 240 ms 交叉淡入（#1393 codex:F1）与遥测简介文案（#1412 F2，文案由老板定）仍未做。

### 2026-10-06 续记 · 二级页标题字重（第二轮）
- 来源：main `bca5fa9a8` → `claude/windows-ui-polish-r2-20261006`；未合 main。只改两处 CSS，不动任何处理函数。
- 缺陷修复：新外观的 token 把页标题定为 28px / 300（与首页的细体大标题一致），但后加载的 `tono.css` 旧规则（24px / 650）按源码顺序胜出，
  线路、活动、账号、支持、设置五页的标题一直是粗体 24px。现在新外观下的 `.tono-page-title` 明确取 token，字距归零。
  同一个类还用在登录页「账号已暂停 / 会话已结束」卡片的标题上（`login.tsx`），它也随之变为 28px / 300，与新外观登录标题的细体一致；这一屏预览里出不来，没有截图（评审 `2045f1b9` opus:F1 指出原记录漏列）。
- 新增/优化：首页大标题改用标题字体栈（`--sea-display`），与二级页标题同一套字；该字体栈补上 `Segoe UI`，没有 Segoe UI Variable 的
  Windows 10 上拉丁字母不再落到微软雅黑的字形。
- 验证：MacBook 预览里读计算样式。改前五页均为 `650 | 24px`；改后中英文十张均为 `300 | 28px`，首页标题 `300 | 64px` 且字体栈为
  `"Segoe UI Variable Display", …`。改前改后截图逐张看过（线路、设置、活动、账号、支持、首页）。`vitest run src/tono-ui` 通过。无新单测（纯 CSS，jsdom 无布局）。
- 评审：jev-route 两次路由一次给 dual、一次给 single，按 dual 执行：Opus 5.5（`2045f1b9`，Codex 核验）PASSED，1 条 minor 即上面的漏列；Codex `gpt-6.1-sol`（`dfb70314`）PASSED 无发现。
- 剩余限制：MacBook 没有 Segoe 字体，预览里看到的是回退字体的 300 字重；Segoe UI Variable Display 与微软雅黑 Light 的实际观感要在
  Windows 真机上看。TextSwap 交叉淡入此前已在 `sea-home.tsx` 实现（240 ms），上文“仍未做”一条作废。
