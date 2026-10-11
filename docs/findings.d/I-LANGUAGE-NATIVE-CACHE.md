| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| I-LANGUAGE-NATIVE-CACHE | Windows 失败启动缓存 zh 后忽略下一次成功读取的 native English | in-PR | [#1561](https://github.com/raydocs/tono/pull/1561) | 低·已确认（生产 preload、模拟 IPC） | 新回归修复前 expected en / received zh，修复后通过；新准确 head CI 与实际升级设备仍待验 |

Sol M1；成功的 native 答复优先且回写缓存，只有无答复/deadline 才沿用缓存。首次渲染使用真实 IntroPage 与 en/zh 资源，不改个人选择或系统语言。
