| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-REPLACEMENT-AI-HOLD | Replacement sign-in retired the old account's live runtime with a full release, dropping the AI hold | in-PR | [#1120](https://github.com/raydocs/tono/issues/1120)；[#1642](https://github.com/raydocs/tono/pull/1642)；[决策 125](../decisions/125-2026-10-13-quit-and-replacement-keep-ai-hold.md) | 高·推导（P1，源码路径） | 只有 `adopt_replacing_with` 用新的窄处置；Sign Out、Restore 与共享的 `release_for_account` 不变；需 Windows CI 与实机 |

旧账户为 Suspended/Error 且运行时仍连接时，换号登录会先退休旧运行时；现在放开普通网络但保留 AI 拦截，新账户等 Connect。

Codex 复审（#1642）记录的两处缺口，未在本 PR 修：App 内存里的「已保留拦截」标志不跨重启（重开后首次 Connect 前 Sign Out 不会完整放开）；「恢复网络」不覆盖已排队、尚未发出的 Quit／换号窄放行。两者都需要 Service 在状态里报告保留的拦截；「恢复网络」随时可以删掉它。
