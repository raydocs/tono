## 2026-10-06 · Windows 新外观 PR 13：逐 PR 评审的修复轮，只保留新外观
- 归属：`docs/SHIP_PLAN.md` 0.0.75；[决策 066](../decisions/066-2026-10-06-sea-appearance-is-the-only-appearance.md)（老板 2026-10-06：
  「和合并的全都合并到 main 只用新外观就好了」）、[决策 067](../decisions/067-2026-10-06-sea-home-and-tray-refuse-ambiguous-input.md)（agent 暂定）。stacked on #1416。
- 来源：`c3c994e7` → 本 PR head，`claude/windows-ui-pr13-review-round-20261006`；未合 main。
- 评审来源（jev-route，逐 PR 的 diff）：#1375 `de0102f9`、#1393 `bcb7ebef`、#1406 `e8f4bad6`、#1407 `6b685fc2`、#1408 `9c6375c8`（BLOCKED）、
  #1409 `7609c403`、#1410 `9b925507`（BLOCKED）、#1411 `35d55379`、#1412 `91788532`、#1413 `2696ac41`、#1414 `c5b379dc`、#1416 `8b4798fe`。
  #1375 / #1393 的 `docs/screenshots` 证据 JSON 因 diff 超过评审上限被排除在评审之外。
- 缺陷修复（两条 major，按 AGENTS 属「保护已释放却显示受保护」一类）：
  - #1408：线路列表的「使用中」只在有实时保护证据（`hasLiveProtection`）时为绿色，否则为中性。
  - #1410：托盘在连接中且屏障保持（`protectionBlocked`）时不再提供「取消」；原先一次点击经 Disconnect 无确认地释放屏障。
- 缺陷修复（minor）：首页 Enter/空格在已连接时不再断开；主按钮变成「取消」后 600 ms 内的点击忽略（防双击）；确认框打开时首页快捷键让位、
  Esc 归确认框；详情面板打开后不再带 transform（否则其中的确认框被面板裁切）；窗口隐藏时首页三个计时器和托盘 1 秒时钟停表；
  首页卸载后共享背景不再留着上一个场景；旧外观下窗口边框恢复（`applyWindowFrame`）；精简档 + 静态档下场景动画关闭；推荐线路按钮只在空闲时出现；
  收藏键 F 不再吞 Ctrl/⌘/Alt 组合；验证码粘贴取独立的六位数字（带日期的整段文本不再拼出错码）；回到起点时清掉拒绝计数；
  托盘连接中副标题用阶段文案；托盘延迟与首页、线路页同为毫秒（#1414 F1）；活动页应用说明标题带应用名、摘要只在已连接时出现；
  账号页不再常驻显示退出确认文案；支持页有冲突或报告失败时技术详情默认展开。
- 新增/优化：设置里的新外观开关移除，首帧标记恒为新外观，旧版本存下的「关」不再读取（决策 066）；0.0.75 中英文发布说明去掉「可关回旧外观」。
  旧外观代码与其测试保留、仅测试可达，删除留给 0.0.75 之后的专门清理。
- 工程与测试：每条行为一条回归，均在旧逻辑上实跑为红：stray Enter、隐藏时停表、背景、首帧标记（4 red）、确认框让位与嵌套 Esc（2 red）、
  双击保护、使用中标记、粘贴验证码、托盘屏障、托盘毫秒（`Unable to find … /816 ms/`）、存储的「关」（`expected false to be true`）。
  `applyWindowFrame` 是新函数，无旧代码对照；两处纯 CSS（面板 transform、静态档动画）无单测，前者只核对了计算值 `transform: none`，
  后者在预览里去掉 `.sea-loop` 核对为 `animation: none`。Codex 的托盘用例「connecting action cancels」原先靠夹具默认的
  `protectionBlocked: true` 通过，现明确写 `protectionBlocked: false`。
- 验证：MacBook，`vitest run` 全量 `Test Files 56 passed (56) / Tests 391 passed (391)`；typecheck `79 (baseline 79)`；
  biome 对触及的 27 个文件无错误（6 条非空断言警告在本 PR 之前已存在）。exact-head ci-gate 与本 PR 的评审见 PR。
- 候选/发布：仅源码，无新候选。冻结源码 `e28ca45c` 与 7501 候选不含本栈；合入后需重新冻结、重出候选并由老板对新包做 G1/G2。
- 剩余限制（未修，记录在案）：TextSwap 240 ms 交叉淡入（#1393 codex:F1）；`vite.shell-preview.config.mts` 预览配置（#1393 codex:F3）；
  旧外观导航词跟随共享词表（#1408 F4）；单个应用超过 20 条连接时没有逐行关闭（#1411 F3）；遥测简介未写「默认开启 / 关闭后仍上报失败」
  （#1412 F2，文案由老板定）。已驳回：#1409 F3、#1410 F5（核验方驳回）、#1407 F2（栈顶已是 Home/Servers）。
  未在 Windows/WebView2 真机验证；面板内确认框的裁切修复未做画面核对。
