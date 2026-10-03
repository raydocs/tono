| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-FAILURE-AI-HOLD | Automatic Windows failed-update restart recovery reuses explicit Restore cleanup and removes the secondary AI hold | fixed(0484176a) | [#978](https://github.com/raydocs/tono/pull/978) | 高·已确认（P1，Linux 回归） | Follow-up to #858; native update/SCM and WFP/NRPT require Windows CI and hardware. Existing recovery errors and narrow-layer limitations remain. |

The automatic caller now selects the emergency release variant that applies the existing narrow AI layer after WFP removal. Explicit Restore and uninstall continue to remove that layer; both existing strict-mode checks in the update executor remain.
