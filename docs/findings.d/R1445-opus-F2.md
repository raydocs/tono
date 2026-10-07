| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1445-opus-F2 | Restore 在 Quit helper IPC 已开始后排队，终止未等待新队尾 | open | [#1445](https://github.com/raydocs/tono/pull/1445) | 低·已确认 | 原队尾等待分支已改为 requestID 排空，但 91f6ecd9 在新 pendingNativeUpdate 查询期间重报同根因：Restore/睡眠推进 generation 后普通 Quit 直接返回，可先于显式 Restore 完成。left open by the jev-route stop rule after 1 fix round (91f6ecd9)；两条为同一缺陷，不重复计数。原生/实机待验。 |

来源：Jev 0f535770（源码9c810678，Codex gpt-6.1-sol/high 与 Opus；最终 minor，当前一轮修复）。

续审 91f6ecd9：Codex gpt-6.1-sol/high 和 Opus 互证 minor，无 major 阻断。新 opus:F1 为本同根因重报，**不覆盖原 R1445-opus-F1（过期闸门，已在续审复核关闭）**。本轮遵 stop rule 不再改源码。
