# R3-RegWin: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:10 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| REG-791 | Windows catalog release | P1 | apps/windows/app/src-tauri/src/tono/connection/switch.rs:62 | Automatic catalog removal uses plain release and removes AI hold | concern: duplicate of #1036 |
| R3REGW-CATALOG-AI-HOLD | Windows catalog release | P1 | apps/windows/app/src-tauri/src/tono/connection/switch.rs:62 | Automatic catalog removal removes secondary AI hold | duplicate of #1036; dropped local implementation |
| REG-990 | Windows account | — | apps/windows/crates/tono-core/src/auth.rs:1605 | Merged regression review | ok: obsolete 401 suppressed only after committed different bearer; current refusals retained; auth suite 59 passed |
| REG-916 | Windows audit upload | — | apps/windows/app/src-tauri/src/tono/log_upload.rs:196 | Merged regression review | ok: upload-scope filter and immutable receipt bytes retained; raw consumption cursor separate from redaction |
| REG-843 | Windows credentials | — | apps/windows/app/src-tauri/src/tono/credentials.rs:766 | Merged regression review | ok: failed latest key mutation retried serially; later write/delete supersedes failure |
| REG-980 | Windows exit credentials | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:400 | Merged regression review | ok: audit and vault flush share bounded exit budget without closing cancelled-quit path |
| REG-837 | Windows frontend CI | — | apps/windows/app/package.json:37 | Merged regression review | ok: additive strict-index ratchet; normal typecheck retained |
| REG-834 | Windows WebSocket IPC | — | apps/windows/crates/tono-plugin-core/src/commands.rs:265 | Merged regression review | ok: full decimal string crosses command and JS boundary; Rust internal u128 preserved |
| REG-807 | Windows WebSocket handshake | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:387 | Merged regression review | ok: timeout bounds handshake only; no filter/state mutation |
| REG-768 | Windows WebSocket recovery | — | apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:161 | Merged regression review | ok: connect watchdog cleared after transport completion; initialization rejection now closes and reconnects |
| R3REGW-HY2-DIRECT-GRAPH | Windows DIRECT graph | P2 | apps/windows/app/src-tauri/src/tono/connection/direct.rs:987 | HY2 UDP reject omission disagrees with optional DIRECT graph proof | false-positive regression: producer omission predates tonight (2026-09-11); out of assigned regression scope |
| R3REGW-FRESH-ARM-READBACK | Windows Service proof | P1 | apps/windows/service/src/core/windows_kill_switch.rs:4053 | Inherited verification acknowledges an undelivered MarkVerified and leaves fresh deadline active | concern: verified; regression test pending on own branch |
