# R3-W9inst: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1042 | hunt/sol-r3inst-rollback-release | needs-hardware | yes | fix(windows): release ordinary traffic after native update rollback |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-UPDATE-ROLLBACK-UNVERIFIED-HOLD | W9 | P1 | apps/windows/service/src/bin/install_service/update_executor.rs:521 | Native publication rollback restarts predecessor but leaves unverified update barrier indefinitely | real-fixed #1042 (merged 6b2be353; ci-gate SUCCESS) |
| W9-FP-VERIFIED-ROLLBACK | W9 | — | apps/windows/service/src/core/windows_kill_switch.rs:3277 | Every successful native rollback leaves normal internet blocked | false-positive verified wanted session is released at Service startup |
| W9-DUP-SCM-RECOVERY | W9 | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:558 | SCM recovery configuration failure bypasses restart/fallback | duplicate BRICK-W9 known open finding |
| W9-FP-LEGACY-JOURNAL | W9 | — | apps/windows/service/src/bin/install_service.rs:1305 | Legacy journal admission can block native update recovery | false-positive no production caller remains |
| W9-FP-DIGEST-PIN | W9 | — | apps/windows/service/src/bin/install_service.rs:1995 | Early new digest pin poisons predecessor rollback | false-positive release Service compiled pin takes precedence |
| W9-FP-UPGRADE-TIMEOUT | W9 | — | apps/windows/app/src-tauri/packages/windows/installer.nsi:824 | Outer timeout terminates coordinated rollback | false-positive confirmed upgrades have no outer timeout |
| W9-FP-RETRY-LOOP | W9 | — | apps/windows/app/src-tauri/packages/windows/installer.nsi:835 | NSIS retries indefinitely | false-positive shared retry counter bounded at three/five |
| W9-FP-UPDATE-FLAG | W9 | — | apps/windows/app/src-tauri/packages/windows/installer.nsi:872 | Raw UPDATE flag changes existing Service preservation | false-positive validated existing-install evidence controls preservation |
| W9-FP-JOURNAL-RETRY | W9 | — | apps/windows/app/src-tauri/packages/windows/installer.nsi:845 | Journal refusal automatically retries | false-positive exit76 abort branch already covered |
| W9-FP-LEGACY-NSIS | W9 | — | apps/windows/service/resources/installer.nsi:18 | Standalone NSIS deletes recovery files | false-positive unused legacy template has no packaging caller |
| W9-FP-PRIVATE-UNPACK | W9 | — | apps/windows/app/src-tauri/packages/windows/installer.nsi:1203 | Private extraction modifies installed product | false-positive native admission and early returns prevent live mutation |
| W9-FP-RESOURCE-ROLLBACK | W9 | — | apps/windows/app/src-tauri/packages/windows/installer.nsi:1273 | New helpers after failed manual rollback allow mixed-generation App repair | false-positive retained manual lease blocks App replacement; documented recovery contract |
| W9-DEFERRED-PARTIAL-STAGE | W9 | P2 | apps/windows/service/src/bin/install_service.rs:81 | Later failed repair can replace queued reboot candidate with incomplete staging | real-unfixed prior deferred target lock plus independent later staging I/O failure; lower priority no native reproduction |
| W9-DUP-SERVICEONLY-ROLLBACK | W9 | P2 | apps/windows/service/src/bin/install_service.rs:2071 | Service-only repair has no predecessor backup after readiness failure | duplicate issue815 known unconfirmed design gap |
| W9-FP-NARROW-RESTART | W9 | — | apps/windows/service/src/core/windows_kill_switch.rs:3371 | Restart after emergency rollback cleanup erases secondary AI hold | false-positive hold uses separate firewall/NRPT rules preserved by startup |
| W9-DUP-RECOVERY-TASK | W9 | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:415 | Task Scheduler failure before publication leaves pending rollback | duplicate X3-2-order issue488 |
| W9-RESOURCE-CANCEL-REPAIR | W9 | P2 | apps/windows/app/src-tauri/packages/windows/installer.nsi:1461 | Cancel a later retry wizard then App repair can use newer resources against rolled-back old core | real-unfixed multistep upgrade failure/cancel/repair; lower priority native verification pending |
| W9-TARGET-PUBLICATION-CLOCK | W9 | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:375 | Complete-target early recovery can omit publication floor | unconfirmed interruption plus old mapped image window; no ordinary impact proved |
