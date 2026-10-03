| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-POLICY-RELOAD-BLOCK | 已连接时流量策略更新会拆掉会话并把 PF 收到 bootstrap | fixed(df90188f) | #966 | 中·推导 | 就地应用失败时非严格整网放行。选择性 AI 钩子未注册，不新写 PF。XCTest 未在本机运行。needs-hardware。仅源码，无新候选。 |

策略先写入内存，连接着就 `scheduleBackgroundOptionalPolicy`。连接尚未完成时不拆尝试，`onCoreStarted` 会再应用。失败分支不再 `disconnect(releaseKillSwitch: false)`。
