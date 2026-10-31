| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UI-07 | 可见但失焦的主窗口按 `hasFocus` 冻结海景，托盘弹窗连接后主窗口的日出相位转换停在旧相位 | in-PR | 待开 | 中·源码 | 待 hosted CI；托盘连接时主窗口的实机观感未验证 |

2026-10-31 修复：失焦但可见的窗口不再冻结，循环和一次性相位转换照常完成，只把 GL 水面降到约 15 fps
（`sea-scene-motion.ts`）。只有 `document.hidden`（最小化、隐藏到托盘）才保持画面并冻结进行中的转换。
回归：`SeaScene.test.tsx` “keeps a visible window that lost focus moving…”，旧源码上断言 `data-paused` 得到 `true`。
