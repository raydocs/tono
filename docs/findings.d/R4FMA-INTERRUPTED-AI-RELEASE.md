| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMA-INTERRUPTED-AI-RELEASE | Interrupted automatic macOS release forgets its pending selective AI hold | fixed(5032de1a) | [#1078](https://github.com/raydocs/tono/issues/1078) | 中·已确认 | P2: recovery trigger plus independent helper death. Durable narrow disposition now precedes PF release; native CI/hardware pending. Disk/native installation failures remain best-effort and never prevent general release. |

Baseline `520294ad`: `KillSwitchManager.swift:577` removes broad intent before `:586` installs selective protection. Startup and stopped-Core watchdog skip installation once broad intent is absent. A root-owned, bounded, fsynced separate record resumes the narrow layer without rearming PF. Explicit release persists a false disposition; a new arm retires old explicit disposition before writing broad intent. No full-network startup block is introduced.
