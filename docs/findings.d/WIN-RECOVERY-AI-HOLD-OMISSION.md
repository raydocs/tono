| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RECOVERY-AI-HOLD-OMISSION | Windows corrupt-state/unhealthy-watchdog and unproven-Core recovery release WFP without applying the existing secondary AI hold | in-PR | [#974](https://github.com/raydocs/tono/pull/974) | 高·已确认（P1，Linux 回归） | General traffic remains released first; the existing suffix/prefix layer is best-effort, with its documented DNS/cache limitations. Native WFP/NRPT behavior requires hardware. |

The release helpers now invoke the existing narrow layer after successful WFP removal, before any wanted-session tombstone write can fail. Strict recovery admission and explicit Restore/Disconnect behavior are preserved.
