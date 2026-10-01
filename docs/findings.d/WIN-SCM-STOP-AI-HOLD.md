| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SCM-STOP-AI-HOLD | Automatic Windows Service Stop/Preshutdown removes the AI hold when releasing an armed session or an idle crash-recovery state | in-PR | hunt/sol-r3svc-service-stop-ai-hold | 高·已确认（P1，Linux 回归） | Selective follow-up to #792. Existing best-effort AI-layer and cleanup-failure limits remain; installed SCM/WFP/NRPT need hardware. |

The Service's existing stop cleanup now uses a dedicated disposition selected under the WFP writer lock: apply the narrow AI layer after an armed non-strict release; preserve the current AI disposition when already idle; retain explicit strict protection. Idle owner-goodbye after an explicit Restore does not install a fresh hold. The update/installer gates, DNS proof, owner retirement and residual-filter sweep remain unchanged.
