## 2026-10-10 · Windows 海面托盘：已连接不再溢出、去掉右侧 8 px 空条（A32）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 A32（#1458–#1461 合入后的海面界面后续）；0.0.76 界面，不进 0.0.75 候选，不是 G4 冻结修复。仅 `apps/windows/app/src/tono-ui/` 托盘呈现。
- 来源：main `2e4a7dfc` → `amp/a32-sea-ui-followups-windows`，草稿 PR（界面 PR，老板看过外观再合）。
- 缺陷修复：
  - [WIN-SEA-TRAY-CONNECTED-OVERFLOW](../findings.d/WIN-SEA-TRAY-CONNECTED-OVERFLOW.md)：已连接时速率行加两条快捷线路超出固定 232 px 弹窗（预览 236 px，出现滚动条，底栏被裁）→ 速率 / Claude AI 行按 #1460 已有规则占掉一条快捷线路，已连接显示一条快捷线路，底栏完整。
  - [WIN-SEA-TRAY-GUTTER-STRIP](../findings.d/WIN-SEA-TRAY-GUTTER-STRIP.md)：外壳 `scrollbar-gutter: stable` 在不滚动的托盘路由也留 8 px 槽，托盘只有 312 px 宽、右侧露出未绘制竖条 → 新外观托盘取消预留，回到 320 px。
- 新增/优化：无。
- 工程与测试：`TrayPanel.test.tsx` 新增一条（已连接且速率在线时只出一条快捷线路）；在旧代码上失败（2 条），改后通过。
- 验证（Linux orb，Node 24）：`npx vitest run src/tono-ui src/pages/tono` 36 文件 275 条通过；`npm run typecheck` 未检查索引 79 = 基线；改动文件 eslint、biome 通过。外壳预览（`vite.shell-preview.config.mts`）320×232、2x 截图，托盘 10 种状态（含中文、长名、保护中未连上、失败）`scrollHeight` 都 ≤ 232；前后对比图在 [evidence](../ops/evidence/2026-10-10-sea-ui-followups/windows/)。真机 Windows WebView2 未测；Linux 没有 Segoe UI，字体度量只按行高 1.33 和 Arial 度量的 FreeSans 估算。
- 候选/发布：仅源码，无新候选。
- 剩余限制：已连接从两条快捷线路变成一条；保留两条就只能压缩间距，那是外观取舍，留给老板（见 PR 正文）。其余 A32 项目需要老板决定，列在 PR 正文。

### 2026-10-10 · 有界UIUX续修（#1495接手）
- 保留已发布commit历史，以merge整合main；不改native transport、保护状态映射或连接handler。
- 纠正旧描述：本轮旧树复测的236/239/242px窗口滚动属实，但底栏文字仍可见；不把先前「底栏被裁」推论冒充实测。右侧8px槽仍复现。
- 新复现：键盘展开线路列表确实超出固定窗口。[WIN-SEA-TRAY-PICKER-CLIPPED](../findings.d/WIN-SEA-TRAY-PICKER-CLIPPED.md)。列表改为窗口内滚动层，长反馈在上方滚动，底栏固定；Escape收起/还焦点，不执行线路命令。
- 本轮源码：[7ecdbbd535ea284ae96b63f7ac0f8d15e83c0a78](https://github.com/raydocs/tono/commit/7ecdbbd535ea284ae96b63f7ac0f8d15e83c0a78)。`pnpm exec vitest run src/tono-ui/TrayPanel.test.tsx --maxWorkers=1`：`Tests 16 passed (16)`，保留既有act警告；`pnpm typecheck`：`unchecked indexed access errors 69 (baseline 79)`；改动文件eslint exit0、Bi​​ome format通过。没有加预算或去掉断言。
- Linux Chromium/DPR2/合成IO：11个关闭状态窗口height/scroll232、width320、底栏bottom216；9线路Tab到最后一条，scrollTop106、控件top143/bottom171；Escape返回summary，命令记录为空。首次长列表probe用了非入口参数、随后误断言原始名字（生产UI显示城市），纠正为既有count=9和末行控件身份后通过，不属产品修复。
- 已逐图检查并归档[本轮前后PNG](../screenshots/windows-tray-2026-10-10/README.md)，旧ops/evidence图片仅为历史，不替代本轮证据。WebView2/Narrator、真实托盘摆放、多屏/DPI仍待最终原生包；无新候选，无发布。
