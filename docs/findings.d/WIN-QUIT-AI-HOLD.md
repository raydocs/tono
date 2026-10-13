| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-QUIT-AI-HOLD | Windows Quit (connected, and the no-product-state route) fully released the selective AI hold | in-PR | [#1052](https://github.com/raydocs/tono/issues/1052)；PR 待填；[决策 125](../decisions/125-2026-10-13-quit-and-replacement-keep-ai-hold.md) | 高·推导（P1，源码路径） | Quit 现在走 Service 的窄（保留 AI 拦截）放行请求；Windows 原生 WFP/NRPT 与旧 Service 的 `LegacyReleasePayload` 回退需 Windows CI 与实机 |

与 Restore internet 重叠的 Quit 仍以 Restore 为准（`begin_release` 取 `apply_narrow` 的与）。
