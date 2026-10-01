| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FMC-MAC-PINS-COMMIT-BLOCK | A committed pins refresh with failed replacement-TUN/PF convergence stops Core but keeps ordinary internet blocked during protected retries | in-PR | hunt/sol-r4fmc-pins-commit-release | 高·推导（P1） | Authored transaction and update-retirement XCTest; Swift unavailable locally. Native CI and PF/DNS hardware acceptance required; changed failure notice needs UI review. |

Baseline `efc511da`: successful `/core/sync` commits pins at
`AppState+Proxy.swift:608–609`, but the replacement tunnel can miss its five-second
deadline at `:618–621`. Helper `CoreManager.swift:178–195` verifies process
startup rather than tunnel readiness. The committed catch at `:705–720` requests
preserve Disconnect and protected retries. Disconnect stops Core, skips DNS
restoration, and restricts PF to bootstrap; normal internet remains unavailable
during those retries. One failed/delayed TUN initialization suffices. This is
a recovery outage, not a demonstrated permanent outage or machine hang.

Prior #782/#1039 explicitly left this actual convergence-failure disposition
unchanged. The precommit keep-session behavior remains correct. Retaining a
temporary DIRECT union is unsafe; this fix stops Core and uses the existing
AI-retaining automatic release, then permits only unarmed retry/proof. Decisions
029/030/033 support that disposition; macOS has no strict opt-in. No helper
contract changes. Current request-ID admission leaves a retired native-update
mutation's cleanup to that newer owner.
