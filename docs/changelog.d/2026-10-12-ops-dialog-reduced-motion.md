## 2026-10-12 · 运维台：系统减少动画时，对话框与底部面板不再播放进场动画
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `origin/main` → 分支 `fix/ops-dialog-reduced-motion`；未合 main。
- 缺陷修复：运维控制台：系统减少动画时，对话框与底部面板不再播放缩放/滑入进场动画（之前第一帧仍是 95% 大小，手机端点按高度检查偶发量到 41.8 px）。`src/styles/globals.css` 的 `prefers-reduced-motion` 块对 `dialog-overlay`、`dialog-content`、`sheet-overlay`、`sheet-content` 直接关掉 animation 和 transition；`e2e/flows-phone.spec.ts` 新增一例断言对话框没有进场动画（旧 CSS 上该例失败，animationName 为 `enter`）。
- 候选/发布：无新包，仅源码。
