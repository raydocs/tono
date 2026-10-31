## 2026-10-31 · Windows 海景能耗与状态修复
- 归属：ops/UI 工作（[运维计划](../ops/plan-2026-09-11.md)），非发布门；Windows 前端 `apps/windows/app/src/tono-ui`。
- 来源：基线 origin/main `372a4cc6c` → 分支 `fix/windows-scene-energy-20261031`，草稿 PR 待开；未合 main。
- 缺陷修复：
  - WIN-UI-07：失焦但可见的主窗口不再冻结海景，托盘连接时日出相位转换照常完成；仅页面隐藏时保持画面。
  - WIN-UI-10：GL 渲染器 dispose 释放 program/shader/buffer 和 context；处理 `webglcontextrestored`。
  - WIN-MISS-01：水面时间项在 JS 双精度下按各自精确周期取模后传入，消除长时运行的 float32 失精，无接缝。
- 新增/优化：WIN-UI-01，内页模糊背景和失焦窗口中 GL 水面降到约 15 fps；所有景物与四档画质保留，可见、聚焦、
  未遮盖时画面不变。修正 `sea-shell.css` 过时注释。
- 工程与测试：GL 渲染器从 `SeaWater.tsx` 移到 `sea-water-gl.ts`（组件文件只导出组件）；新增
  `sea-scene-motion.ts` 纯策略。测试：`sea-scene-motion.test.ts`、`sea-water-gl.test.ts`（2 个）、替换
  `SeaScene.test.tsx` 中断言失焦即冻结的旧用例。
- 验证：MacBook 本地 `vitest run src/tono-ui` 24 文件 94 测试通过；`tsc --noEmit`、改动文件 eslint 通过。
  Red：失焦用例在旧源码上 `data-paused` 为 `true`；GL 用例在旧渲染器上 createProgram 1 次。hosted ci-gate 未看。
- 候选/发布：仅源码，无新候选。
- 剩余限制：WIN-UI-02 未修（仅 plausible，需实机确认 WebView2 隐藏后的 visibilityState）；内页是否改用预模糊
  静态层需所有者决定；未做实机 GPU/能耗对比。
