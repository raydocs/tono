# R4-FixWinSwitch: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:54 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1133 | hunt/sol-r4fws-health-switch | needs-hardware | yes | fix(windows): reject stale health release after a hot switch |
| 1138 | hunt/sol-r4fws-timeout-owner | needs-hardware | yes | fix(windows): keep unarmed recovery after its own Connect timeout |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4-WIN-UNARMED-SELECTION | Windows/unarmed recovery | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:124 | Late proof overwrites newer idle selection (#1094) | duplicate of #1098 |
| R4-WIN-STALE-HEALTH-RELEASE | Windows/health switch | P2 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Old A failure releases healthy B (#1093/#1095) | real-fixed #1133 |
| FP-HEALTH-GENERATION | Windows/health switch | — | apps/windows/app/src-tauri/src/tono/commands/catalog.rs:294 | Generation-only guard already protects hot switch | false-positive hot switch deliberately preserves generation |
| FP-HEALTH-TERMINAL | Windows/health switch | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1162 | Discarded same-generation proof may terminate monitor | false-positive monitor must continue; regression verifies this |
| WIN-UNARMED-TIMEOUT-OWNER | Windows/unarmed recovery | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:159 | Own timeout retirement ends automatic recovery (#1101) | real-fixed #1138 |
| FP-TIMEOUT-REPLACEMENT | Windows/unarmed recovery | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:33 | Failure spawns a replacement recovery owner | false-positive task-local suppression prevents replacement |
