| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UI-10 | 海面 GL 渲染器 dispose 不释放 program/shader/buffer/context，且没有 `webglcontextrestored` 处理 | in-PR | 待开 | 低·源码 | 真实 GPU 丢失/恢复未实机复现；待 hosted CI |

2026-10-31 修复：渲染器移到 `sea-water-gl.ts`；dispose 删除 GL 对象并调用 `WEBGL_lose_context.loseContext()`；
`webglcontextrestored` 重建 program 并在需要时恢复绘制；StrictMode 在同一 canvas 重挂载时，等丢失事件处理后再请求恢复。
回归：`sea-water-gl.test.ts` “releases its GL objects…”，旧渲染器（仅加导出别名）上 createProgram 只调用 1 次。
