# R3-MacQuitHold: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:59 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1031 | hunt/sol-r3quit-ai-hold-decision | needs-hardware | no | docs(macos): record Quit AI-hold policy conflict |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| MAC-QUIT-AI-HOLD | macOS Quit/helper | P1 | apps/macos/Tono/App/AppDelegate.swift:350 | Successful normal Quit removes the selective AI floor | real-unfixed decision item #1031: documented explicit Disconnect full release requires reconciliation with TOP stop rule |
| MAC-QUIT-AI-HOLD-WATCHDOG | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:250 | Watchdog might restore AI hold after successful Quit | false-positive successful disarm deletes state; watchdog selective application requires state file |
| MAC-QUIT-AI-HOLD-WINDOWS-PREMISE | Windows comparison | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:331 | Windows connected explicit Quit might already retain AI hold | false-positive explicit Quit requests full release; referenced fixes cover automatic recovery/Service stop |
