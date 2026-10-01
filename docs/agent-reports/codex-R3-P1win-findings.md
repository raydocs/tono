# R3-P1win: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:47 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1046 | hunt/sol-r3p1w-direct-auto-release | needs-hardware | no | docs(windows): record automatic DIRECT release safety blocker |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows automatic DIRECT recovery | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Automatic release never cancels the stalled DIRECT reader | real-unfixed decision required: existing release opens WFP before best-effort AI hold |
| WIN-REPLACEMENT-HEAL-STATE | Windows replacement account | P2 | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Replacement sign-in retains previous account fallback and recovery history | duplicate of #1047; independent exact-source regression failed before and passed after; own implementation dropped |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows update recovery | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:277 | Failed Prepare during Connecting omits immediate generation-owned recovery | real-unfixed same AI-preserving release blocker as P1; cancellation-only or earlier release violates top rule |
