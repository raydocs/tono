| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-PREPARE-FAILURE-AI-HOLD | Automatic non-strict failed-Prepare cleanup releases general traffic with explicit Restore semantics and removes the AI hold | in-PR | hunt/sol-r3svc-prepare-failure-ai-hold | 高·已确认（P1，源码与回归） | Windows-only regression authored before the behavior change; native execution and WFP/NRPT acceptance require CI/hardware. Existing narrow layer is best-effort. |

Follow-up to #793's availability fix, distinct from #978's failed-restart executor cleanup. After stopping Core, a normal preparation failure (DNS restoration or desired-state persistence) enters automatic release. It now uses `release_applying_narrow` while retaining the recorded release request, recovery obligation, owner authorization and strict-mode admission.
