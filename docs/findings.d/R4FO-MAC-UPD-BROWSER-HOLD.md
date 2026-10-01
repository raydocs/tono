| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FO-MAC-UPD-BROWSER-HOLD | Browser-health failure during private update staging takes explicit update Disconnect and drops the secondary AI hold | in-PR | hunt/sol-r4fo-update-failure-ai-hold (this PR) | 低·推导（P2） | Source-verified seconds-long staging/health overlap; XCTest and helper regressions authored but native execution unavailable locally; old unpaired helper cannot accept the new operation |

The pending-update dispatcher at `AppState+Connect.swift:722` previously discarded `automaticFailureRelease` and `afterUnarmedConnectFailure`. Monitoring remains active until staging completes, and the update runtime's default Disconnect calls ordinary disarm. A distinct owner-gated update failure-release operation carries the narrow disposition without changing receipt obligations or installation authority. A joining explicit Restore remains authoritative after staging advances the generation.
