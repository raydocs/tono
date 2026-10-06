## 2026-10-06 · macOS 首页只展示带时间的近期线路读数
- Status: provisional
- Chosen: polish A 的「有 fresh reading 才展示」只接受当前线路最近 120s 成功实测的 `ProxyService.lastExitSample`；失败、线路不符、未来时间、缺读数均隐藏数字。120s 对应已有 Tono selected-exit 测量周期。不把无时间的 catalog/runtime 缓存值包装为当前读数，也不添加测量、计时器或处理器。
- Rejected: 用 runtime.latency 的正数即声称当前有效；凭空补数或显示占位横线。
- Why stricter: 没有可确认的近期读数时少说，不改变连接、选线或保护逻辑。
- Applied in: [#1426](https://github.com/raydocs/tono/pull/1426)，`SeaHomePresentation`，首页线芯片及一条窄 XCTest。
