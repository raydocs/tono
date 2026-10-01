# R4-FailOpen: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:23 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1061 | hunt/sol-r4fo-browser-ai-hold | needs-hardware | yes | fix(macos): preserve AI hold during automatic cleanup |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FO-MAC-BROWSER-AI-HOLD | macOS browser health | P1 | apps/macos/Tono/Services/AppState+Connect.swift:1651 | Automatic browser DNS health release removes AI hold after #760/#1048 | real-fixed #1061 |
| R4FO-MAC-UNARMED-CLEANUP-AI-HOLD | macOS connect failure | P1 | apps/macos/Tono/Services/AppState+Connect.swift:975 | Unarmed automatic cleanup removes the helper AI hold after native arm failure | real-fixed #1061 |
| R4FO-WIN-RELEASE-AI-DISPOSITION-CRASH | Windows selective recovery | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2812 | Interrupted automatic release persists no requested AI disposition | real-unfixed issue #1077; durable recovery design and native timing remain |
| R4FO-MAC-SELECTIVE-CRASH-INTENT | macOS selective recovery | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:577 | Helper death after general intent deletion permanently forgets AI application | real-unfixed issue #1078; separate durable contract and native test required |
| R4FO-UPD-TASK-ROLLBACK-HOLD | Windows native update | P1 | apps/windows/service/src/bin/install_service/update_executor.rs:433 | Task Scheduler refusal returns before proven rollback releases ordinary traffic | duplicate of #1075 (opened during verification; local patch dropped) |
