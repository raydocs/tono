| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UI-01 | Windows 内页背后整幅海景（含 WebGL 水面）在全窗 `filter: blur(14px)` 下全速运行，CSS 注释却说已暂停 | in-PR | 待开 | 高·源码 | 只把 GL 水面降到约 15 fps；CSS 循环和模糊仍每帧付出。内页的模糊海景仍可见，按修正规则 2 不算“被遮盖”，故不暂停。是否改用预模糊静态层需所有者决定；待 hosted CI 与实机 GPU 对比 |

2026-10-31 修复（fix/windows-scene-energy-20261031）：`SeaBackdrop` 在内页给 `SeaScene` 传 `blurred`，
`sea-scene-motion.ts` 的纯策略返回 `throttled`，水面以约 15 fps 绘制，星、云、流星、粒子和水面都保留运动；
修正了 `sea-shell.css` 中过时的“已暂停”注释。回归：`sea-scene-motion.test.ts`（新模块，旧代码上无法导入，不算红）。
