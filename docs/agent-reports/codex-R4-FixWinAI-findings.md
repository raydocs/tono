# R4-FixWinAI: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1147 | hunt/sol-r4fwa-ai-hold | needs-hardware | yes | fix(windows): persist automatic AI hold across Service death |
| 1155 | hunt/sol-r4fwa-rollback-finalize | needs-hardware | yes | fix(windows): replay interrupted rollback finalization |
| 1163 | hunt/sol-r4fwa-capture-refusal | needs-hardware | yes | fix(windows): finalize native update token capture refusal |
| 1168 | hunt/sol-r4fwa-recovery-clock | needs-hardware | yes | fix(windows): fence App adoption after publication recovery |
| 1172 | hunt/sol-r4fwa-consume-refusal | needs-hardware | yes | fix(windows): selectively finalize failed consume writes |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FO-WIN-RELEASE-AI-DISPOSITION-CRASH | Windows Service | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2875 | Automatic release loses AI hold intent across Service death | real-fixed #1147 |
| R4UPD-WIN-ROLLBACK-FINALIZATION | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:386 | RolledBack recovery skips interrupted selective finalization | real-fixed #1155 |
| R4UPD-WIN-CAPTURE-FAILURE-RELEASE | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:417 | Token capture refusal exits before failure cleanup | real-fixed #1163 |
| WIN-UPDATE-TOKEN-FLUSH | Windows App update | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:201 | Native update terminates App without retrying queued session credential write | real-unfixed #1055: requires complete auth-mutation pause/drain held through executor handoff; bare flush races refresh |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:394 | Complete-publication early recovery omits process-age floor | real-fixed #1168 (only this #1055 row) |
| R3REGW-ROLLBACK-DOUBLE-HOLD | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:91 | Repeated update cleanup formerly interrupted AI hold | duplicate of merged #1087 |
| R3KS1-PENDING-EXPIRY | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3693 | Pending DIRECT expiry retains healthy full Blocked after App death | real-unfixed #1056; documented strict pending design requires product disposition |
| WIN-SELECTIVE-NATIVE-ORPHAN | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:327 | Native command ownership across Service death is process local | duplicate known limitation #988 |
| R4FO-WIN-SELECTIVE-SYSTEM-DIR | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:327 | Fixed C-drive netsh path fails on non-C Windows | duplicate merged #1089 |
| R4FWA-FP-STARTUP-AUTO-REPLAY | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3371 | Assumed unwanted startup already reapplies absent AI hold | duplicate #1147 proof: rejected proposed guard; startup preserved existing AI layer but did not apply missing one |
| R4FWA-FP-IDLE-REWRITE-SAFE | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:2830 | Assumed idle rewrite and replacement preserve automatic disposition | duplicate #1147 proof: rejected proposed guard; idle/replacement discarded automatic disposition |
| R4FWA-FP-SINGLETON-FLOOR | Windows update | - | apps/windows/service/src/bin/install_service/update_executor.rs:394 | Assumed ordinary parallel initialized Apps can exploit missing floor | false-positive severity premise: singleton forbids this; pre-singleton mapped peer window only |
| R4FWA-FP-LEGACY-BINDING-STALE-TOKEN | Windows credentials | — | apps/windows/app/src-tauri/src/credentials.rs:315 | Legacy binding migration could overwrite a rotated token | false-positive: vault lock and current-binding read guard stale migration |
| R4FWA-FP-WORKER-CANCEL | Windows selective layer | — | apps/windows/service/src/core/selective_layer.rs:42 | Cancellation could strand the selective worker owner | false-positive: no await between ownership and worker spawn |
| R4FWA-FP-WORKER-COMPLETION | Windows selective layer | — | apps/windows/service/src/core/selective_layer.rs:97 | An old coalesced request could win over a newer disposition | false-positive: completion settles only the latest revision under admission lock |
| R4FWA-FP-COMMAND-INJECTION | Windows selective layer | — | apps/windows/service/src/core/selective_fail_open.rs:193 | Permissive add validator could admit a broad firewall command | false-positive: private runner receives only fixed generated templates |
| R4FWA-FP-NRPT-COLLATERAL | Windows selective DNS | — | apps/windows/service/src/core/selective_fail_open.rs:32 | Secondary DNS could block unrelated general Internet | false-positive: fixed suffix set and unique GUIDs exclude catch-all |
| R4UPD-WIN-CONSUME-FAILURE-RELEASE | Windows update | P1 | apps/windows/service/src/update_transaction.rs:468 | Successful token capture followed by failed consume acknowledgement skips network cleanup | real-fixed #1172 (Fixes #1171) |
| R4FWA-FP-EXPIRED-CONSUME-RELEASE | Windows update | — | apps/windows/service/src/update_transaction.rs:467 | All post-capture consume failures should automatically release | false-positive: expiry/clock refusal intentionally retains protection per UPDATE_PROTOCOL_V1:96; only persistence error is changed |
