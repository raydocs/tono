| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R1445-opus-F3 | 无 AppState 的退出兜底未准备新版 helper、也未停止 Core 就调用新版 Quit API | fixed(53676e913) | [#1445](https://github.com/raydocs/tono/pull/1445) | 低·已确认 | 兜底先 helper repair，再 Core stop/已停止证明和 DNS restore，最后新版 Quit；任何失败不伪报完成。 原生 CI/续审待验；真实退出、旧 helper 安装及 PF/DNS 留 G1/G2，未合 main，不能标 fixed。 |

来源：Jev 0f535770（源码9c810678，Codex gpt-6.1-sol/high 与 Opus；最终 minor，当前一轮修复）。
