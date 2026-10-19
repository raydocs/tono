| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-STATUS-VPN-UNKNOWN | Android 共享状态把未知 VPN 查询结果当作可继续确认已连接 | in-PR | [#1673](https://github.com/raydocs/tono/pull/1673) | 中·已确认 | f769fc43b 上真实 JUnit 断言失败、工作区新代码通过；尚未推送，Android 设备状态/实际流量未验证，不声称已发生泄漏 |

证据：[本地状态 JUnit red/green](../agent-reports/2026-10-19-android-state-jvm/README.md)。与 r8 引擎死亡后通知遗留窗口相关，但这是未知查询分支的独立逻辑约束，不把两者时延当成同一证据。
