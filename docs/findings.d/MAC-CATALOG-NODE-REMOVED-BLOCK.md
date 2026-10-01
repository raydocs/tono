| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CATALOG-NODE-REMOVED-BLOCK | 选中的云出口从目录消失后，已连接会话被整机阻断，即使还有别的出口 | in-PR | 待开 | 中·推导 | macOS 没有 `permanent` 开关，非严格走整网放行。选择性 AI 钩子未注册，本改动不新写 PF。热切换失败才放行。XCTest 未在本机运行。needs-hardware。仅源码，无新候选。 |

空闲且未连接的 Mac 仍按原来的文案要求用户选出口。有幸存者时保持连接并改选；没有幸存者时 `disconnect(releaseKillSwitch: true)`。严格分支留在 `CatalogRemovedExitAction`，当前调用传入 `strictKillSwitchExplicit: false`。
