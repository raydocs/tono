# R4-Issue1051: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:48 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows App | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Automatic health release does not retire stalled DIRECT lifecycle reader | real-unfixed #1051: no AI-preserving backend without prohibited availability tradeoff; evidence report.md |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows App | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:277 | Failed Prepare folds current armed Connecting without immediate release | real-unfixed #1051: same AI-preserving release blocker |
| R4I1051-AI-RELEASE-PROOF | Windows Service | - | apps/windows/service/src/core/selective_layer.rs:61 | Narrow request returns without installation proof after WFP removal | duplicate of #1046 recorded blocker; reverified with paused-worker regression |
