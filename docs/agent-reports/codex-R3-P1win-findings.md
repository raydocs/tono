# R3-P1win: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:59 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1046 | hunt/sol-r3p1w-direct-auto-release | needs-hardware | no | docs(windows): record automatic DIRECT release safety blocker |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows automatic DIRECT recovery | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Automatic release never cancels the stalled DIRECT reader | real-unfixed decision required; recorded #1046: existing release opens WFP before best-effort AI hold |
| WIN-REPLACEMENT-HEAL-STATE | Windows replacement account | P2 | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Replacement sign-in retains previous account fallback and recovery history | duplicate of #1047; independent exact-source regression failed before and passed after; own implementation dropped |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows update recovery | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:277 | Failed Prepare during Connecting omits immediate generation-owned recovery | real-unfixed same AI-preserving release blocker as P1; recorded #1046; earlier release violates top rule |
| FP-DIRECT-CANCEL-LOSES-CLEANUP | Windows DIRECT ownership | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1335 | Cancelling a DIRECT controller wait abandons exact retraction | false-positive detached owner reconciles captured session before lifecycle reader drops |
| FP-HEAL-CREDENTIAL-LEAK | Windows account privacy | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Retained fallback can reuse previous account credentials | false-positive previous catalog/routing dropped; a surviving name uses the new catalog credentials |
| FP-HEAL-RESET-DISARMS-WFP | Windows protection state | — | apps/windows/app/src-tauri/src/tono/connection/heal.rs:36 | Clearing healer protection history disarms native protection | false-positive advisory recovery bit is separate from FSM/Service; prepare derives it from actual FSM |
