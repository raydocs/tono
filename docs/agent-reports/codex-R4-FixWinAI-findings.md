# R4-FixWinAI: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1147 | hunt/sol-r4fwa-ai-hold | needs-hardware | yes | fix(windows): persist automatic AI hold across Service death |
| 1155 | hunt/sol-r4fwa-rollback-finalize | needs-hardware | yes | fix(windows): replay interrupted rollback finalization |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FO-WIN-RELEASE-AI-DISPOSITION-CRASH | Windows Service | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2875 | Automatic release loses AI hold intent across Service death | real-fixed #1147 |
| R4UPD-WIN-ROLLBACK-FINALIZATION | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:386 | RolledBack recovery skips interrupted selective finalization | real-fixed #1155 |
| R4UPD-WIN-CAPTURE-FAILURE-RELEASE | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:417 | Token capture refusal exits before failure cleanup | real-verified assigned #1082 |
| WIN-UPDATE-TOKEN-FLUSH | Windows App update | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:201 | Native update terminates App without retrying queued session credential write | real-unfixed #1055; safe scope still under review |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:394 | Complete-publication early recovery omits process-age floor | real-verified assigned #1055 |
| R3REGW-ROLLBACK-DOUBLE-HOLD | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:91 | Repeated update cleanup formerly interrupted AI hold | duplicate of merged #1087 |
| R3KS1-PENDING-EXPIRY | Windows WFP | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3693 | Pending DIRECT expiry retains healthy full Blocked after App death | real-unfixed #1056; documented strict pending design requires product disposition |
| WIN-SELECTIVE-NATIVE-ORPHAN | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:327 | Native command ownership across Service death is process local | duplicate known limitation #988 |
| R4FO-WIN-SELECTIVE-SYSTEM-DIR | Windows selective layer | P2 | apps/windows/service/src/core/selective_layer.rs:327 | Fixed C-drive netsh path fails on non-C Windows | duplicate open #1089 |
| R4FWA-FP-STARTUP-AUTO-REPLAY | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3371 | Assumed unwanted startup already reapplies absent AI hold | false-positive guard hypothesis: startup preserves existing layer but never applies it |
| R4FWA-FP-IDLE-REWRITE-SAFE | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:2830 | Assumed idle rewrite and replacement preserve automatic disposition | false-positive guard hypothesis: they replace it with default tombstone |
| R4FWA-FP-SINGLETON-FLOOR | Windows update | - | apps/windows/service/src/bin/install_service/update_executor.rs:394 | Assumed ordinary parallel initialized Apps can exploit missing floor | false-positive severity premise: singleton forbids this; pre-singleton mapped peer window only |
