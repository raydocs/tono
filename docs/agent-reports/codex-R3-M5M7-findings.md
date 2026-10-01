# R3-M5M7: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:24 MT from the run's findings.tsv / prs.tsv.

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
| M5M7-H07 | M5 | P0 | apps/macos/Tono/Core/HelperManager.swift:1396 | Helper socket write can deliver SIGPIPE | duplicate user ALREADY-KNOWN SIGPIPE in HelperManager.writeAll |
| M5M7-H08 | M7 | P2 | apps/macos/Tono/Services/AppState.swift:740 | Wake owner survives native-update release and reconnects | duplicate #1001 |
| M5M7-H09 | M7 | — | apps/macos/Tono/Services/AppState.swift:1346 | Late runtime setting callback reapplies proxy after disconnect | false-positive TUN forced on in Connect; owned mode refuses TUN off and no production applySettingChange callers found |
| M5M7-H10 | M7 | — | apps/macos/Tono/Services/AppState.swift:526 | Network reconciliation publishes over a new session | false-positive task cancelled on teardown and post-I/O cancellation guard fences publication |
| M5M7-H11 | M7 | — | apps/macos/Tono/Services/AppState.swift:701 | Cancelled sleep bootstrap restriction runs after release | false-positive restriction no-ops after local armed intent is cleared; helper actor serialized |
| MAC-QUIT-AI-HOLD | M5/M7 | P1 | apps/macos/Tono/App/AppDelegate.swift:343 | Normal Quit removes the selective AI blocking floor through plain helper disarm | real-unfixed helper release-disposition contract required; helper edits forbidden for this slot; older explicit-disconnect design needs reconciliation with TOP rule for stop |
| M5M7-H13 | M5 | — | apps/macos/Tono/Core/HelperManager.swift:800 | A failed core-status reply falsely proves Core stopped | false-positive errors return running=true and verified=false; cleanup checks verification |
| M5M7-H14 | M5 | — | apps/macos/Tono/Core/PrivilegedRuntimeCoordinator.swift:134 | A late arm interleaves inside a helper release transaction | false-positive mutation methods are synchronous with no actor suspension points |
| M5M7-H15 | M5 | — | apps/macos/Tono/Core/HelperManager.swift:810 | Missing running field falsely proves Core stopped | false-positive signed helper always emits Bool; transport truncation fails JSON decoding |
| M5M7-H16 | M5 | — | apps/macos/Tono/Core/HelperManager.swift:1176 | Long update Stage timeout cuts network | false-positive Stage precedes Core/PF mutation; current working traffic continues |
| M5M7-H17 | M5 | — | apps/macos/Tono/Services/SupportDiagnostics.swift:82 | Diagnostics blocks the main actor on helper IPC | false-positive blocking probes run detached |
| M5M7-H18 | M5 | — | apps/macos/Tono/Core/HelperManager.swift:680 | Unbounded launchctl wait could wedge cleanup | unverified no ordinary launchctl hang trigger proved; retained hardening candidate |
| M5M7-H19 | M5 | — | apps/macos/Tono/Core/HelperManager.swift:388 | Installer stderr pipe hangs after AppleScript exit | unverified no surviving inherited writer demonstrated; helper daemon uses /dev/null |
| M5M7-H20 | M5 | P2 | apps/macos/Tono/Core/HelperManager.swift:1210 | Failed silent upgrade delivery incurs a 45-second poll | duplicate #759 |
| M5M7-H21 | M5 | P1 | apps/macos/Tono/Core/RuntimeCleanup.swift:263 | Launch update-status timeout bypasses helper recovery | duplicate #840; current main handles emptyResponse and socketFailed |
| M5M7-H22 | M5 | P1 | apps/macos/Tono/Core/HelperManager.swift:259 | Abandoned helper replacement retains PF after Core stop | duplicate #794; current main has standard release cleanup |
| M5M7-H23 | M7 | — | apps/macos/Tono/Services/Catalog/ManagedCatalogProcessor.swift:38 | Legacy custom nodes permanently reject managed catalogs | false-positive unrestricted nodes used LiquidClash storage; Tono rename introduced validation and dev-only controls; no migration found |
| M5M7-H24 | M7 | — | apps/macos/Tono/Services/Persistence/LocalRoutePreferences.swift:55 | Retired preferred region prevents connection | false-positive intentional recommendation filter; normal selection and Connect remain available |
| M5M7-H25 | M7 | — | apps/macos/Tono/Services/AppState+LaunchProtection.swift:46 | Delayed launch status clears newer protection | false-positive launch sequence and protection generation fence stale answers |
| M5M7-H26 | M5 | — | apps/macos/Tono/Core/RuntimeCleanup.swift:205 | First update query makes rejecting-helper reinstall unreachable | false-positive ordering gap is latent; signed replacement keeps stable identity; deliberate invalid signing/other-UID refusals must remain |
| M5M7-H27 | M5 | — | apps/macos/Tono/Core/RuntimeCleanup.swift:360 | Unverified Core status leaves an orphan running at launch | false-positive ordinary sessions have local Core-start or helper protection evidence; absent evidence plus failed status requires additional failure |
| M5M7-H28 | M5 | — | apps/macos/Tono/Core/RuntimeCleanup.swift:374 | Cleared Core-start marker prevents a DNS restore retry | false-positive snapshotless residue plus another DNS failure needs two failures; original omission covered by #756 |
| M5M7-H29 | M5 | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:127 | Stale precomputed digest admits different runtime bytes | false-positive helper verifies secure snapshot SHA and rejects mismatch; runtime task ownership serializes writes |
| M5M7-H30 | M5/M7 | — | apps/macos/Tono/Core/RuntimeCleanup.swift:97 | Failed boot-record deletion blocks the next launch | false-positive only conservative automatic-resume pause after reboot; explicit Connect rewrites marker and remains available |
| M5M7-H31 | M7 | — | apps/macos/Tono/Services/AppState+Catalog.swift:537 | Decodable corrupt policy metadata can reject a matching revision | unverified ordinary corruption path not proved; optional policy refresh does not block sign-in or protected connectivity |
| M5M7-H32 | M5 | P2 | apps/macos/Tono/Core/RuntimeCleanup.swift:224 | Protected Offline native update never commits after fail-open launch | duplicate #795 |
| M5M7-H33 | M5 | P2 | apps/macos/Tono/Core/RuntimeCleanup.swift:410 | Helper repair skips snapshotless DNS restoration | duplicate #756; current main restores after an available recheck |
| M5M7-H34 | M5 | — | apps/macos/Tono/Core/RuntimeCleanup.swift:365 | Orphan Core stop at launch removes selective AI blocking | false-positive launch does not disarm; subsequent helper Core-down watchdog applies selective hold |
