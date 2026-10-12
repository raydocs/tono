| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-LANGUAGE-DEADLINE-KEYS | Windows 初始 IPC 超过 2 秒时在语言资源完成前渲染 intro，显示未翻译键 | in-PR | [#1561](https://github.com/raydocs/tono/pull/1561) | 低·已确认（生产入口、模拟慢 IPC） | 回归在基线 134e126a 失败、改后通过；真实 WebView2 冷启动第一帧仍待签名候选包 |

执行实际 `main.tsx`、IntroPage 和真实语言资源，替换 native IO 为未返回 Promise；缓存 English、延迟加载 locale，2 秒后 root 必须保持空，资源完成后才显示 English 标题。基线未修改的入口在资源加载前显示 `tono.intro.*`，修复等待缓存/默认资源，不改 late native choice reconciliation 或窗口 show 事件。
