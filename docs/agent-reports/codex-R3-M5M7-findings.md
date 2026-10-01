# R3-M5M7: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:33 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| M5M7-H01 | M7 | — | apps/macos/Tono/Core/ExitHeal.swift:1 | Exit-heal model can retain stale recovery state | false-positive no production callers; latent model only |
| M5M7-H02 | M7 | P3 | apps/macos/Tono/Services/AppState+Persistence.swift:22 | Concurrent scene loads apply the disk snapshot twice | duplicate #854 |
| M5M7-H03 | M7 | — | apps/macos/Tono/Services/AppState+Persistence.swift:69 | Persisted config restores a stale controller credential | false-positive process secret captured and restored after config load |
| M5M7-H04 | M7 | — | apps/macos/Tono/Services/Persistence/LocalRoutePreferences.swift:85 | Route successes cross accounts or silently reconnect | false-positive hashed owner plus current owner/digest/generation checks and explicit confirmation |
| M5M7-H05 | M7 | — | apps/macos/Tono/Services/Persistence/InitialDataLoader.swift:36 | Partial config JSON strands launch readiness | false-positive failed decode falls back to nil; loader completes readiness |
| M5M7-H06 | M7 | — | apps/macos/Tono/Services/AppState+Persistence.swift:116 | State writes overtake newer snapshots | false-positive task chain awaits prior writer; actor performs writes in order |
| M5M7-H07 | M5 | P0 | apps/macos/Tono/Core/HelperManager.swift:1322 | Helper socket write can deliver SIGPIPE | duplicate user ALREADY-KNOWN SIGPIPE in HelperManager.writeAll |
| M5M7-H08 | M7 | P2 | apps/macos/Tono/Services/AppState.swift:740 | Wake owner survives native-update release and reconnects | duplicate #1001 |
| M5M7-H09 | M7 | — | apps/macos/Tono/Services/AppState.swift:1346 | Late runtime setting callback reapplies proxy after disconnect | false-positive TUN forced on in Connect; owned mode refuses TUN off and no production applySettingChange callers found |
| M5M7-H10 | M7 | — | apps/macos/Tono/Services/AppState.swift:526 | Network reconciliation publishes over a new session | false-positive task cancelled on teardown and post-I/O cancellation guard fences publication |
| M5M7-H11 | M7 | — | apps/macos/Tono/Services/AppState.swift:701 | Cancelled sleep bootstrap restriction runs after release | false-positive restriction no-ops after local armed intent is cleared; helper actor serialized |
