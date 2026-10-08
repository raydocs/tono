| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1445-opus-F1 | 过期本地更新闸门使普通 Quit 跳过 DNS/PF 释放 | fixed(53676e913) | [#1445](https://github.com/raydocs/tono/pull/1445) | 低·已确认 | 改由认证的 fresh no-pending query 退休旧闸门；pending/不可读不竞争执行器；新增真实 AppState 窄回归。 原生 CI/续审待验；真实退出、旧 helper 安装及 PF/DNS 留 G1/G2，未合 main，不能标 fixed。 |

来源：Jev 0f535770（源码9c810678，Codex gpt-6.1-sol/high 与 Opus；最终 minor，当前一轮修复）。
