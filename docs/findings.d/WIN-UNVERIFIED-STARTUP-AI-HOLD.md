| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNVERIFIED-STARTUP-AI-HOLD | A Service crash during the first connection retires unverified protection using explicit Restore semantics, leaving no secondary AI hold | in-PR | hunt/sol-r3svc-unverified-recovery-ai-hold | 高·已确认（P1，Linux 回归） | Existing narrow suffix/prefix layer remains best-effort; Windows WFP/NRPT and installed-device recovery require hardware. |

Distinct from #974: this is the unverified initial-attempt retirement path, rather than corrupt-state, unhealthy-watchdog or verified wanted-Core recovery. A single interrupted first connection reaches `retire_unverified_on_service_start` after orphan reconciliation. Successful automatic release now applies the existing AI hold. Explicit strict intent is retained before owner retirement; current production arm does not expose a strict toggle. Explicit Restore/Disconnect behavior stays unchanged.
