One verified P1 remains unfixed: **normal Quit removes AI blocking**. Fixing it requires a helper release option that preserves the AI layer; helper changes are forbidden for this slot. The earlier explicit-disconnect policy also needs reconciliation with your TOP rule.

Paths below are relative to `apps/macos/Tono/`. `Hxx` abbreviates `M5M7-Hxx`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-QUIT-AI-HOLD | M5/M7 | P1 | App/AppDelegate.swift:343 | Quit invokes plain disarm, removing the AI layer | Real-unfixed: helper contract change required |
| H01 | M7 | — | Core/ExitHeal.swift:1 | Heal state could retain stale recovery | False positive: no production callers |
| H02 | M7 | P3 | Services/AppState+Persistence.swift:22 | Concurrent launches apply disk state twice | Duplicate #854 |
| H03 | M7 | — | Services/AppState+Persistence.swift:69 | Disk config replaces controller credentials | False positive: fresh secret restored |
| H04 | M7 | — | Services/Persistence/LocalRoutePreferences.swift:85 | Route history crosses accounts | False positive: ownership and generation guards |
| H05 | M7 | — | Services/Persistence/InitialDataLoader.swift:36 | Partial preferences strand launch | False positive: decoding failure falls back |
| H06 | M7 | — | Services/AppState+Persistence.swift:116 | Saves persist snapshots out of order | False positive: predecessor task drained |
| H07 | M5 | P0 | Core/HelperManager.swift:1396 | Socket writes can raise SIGPIPE | Duplicate: already known |
| H08 | M7 | P2 | Services/AppState.swift:740 | Wake reconnect survives update release | Duplicate #1001 |
| H09 | M7 | — | Services/AppState.swift:1346 | Late settings callback restores dead proxy | False positive: TUN enforced; no production caller |
| H10 | M7 | — | Services/AppState.swift:526 | Reconciliation overwrites a newer session | False positive: cancellation guards |
| H11 | M7 | — | Services/AppState.swift:701 | Sleep restriction runs after release | False positive: unarmed restriction does nothing |
| H13 | M5 | — | Core/HelperManager.swift:800 | Failed status falsely proves Core stopped | False positive: failure remains unverified |
| H14 | M5 | — | Core/PrivilegedRuntimeCoordinator.swift:134 | Arm interleaves within release | False positive: synchronous actor transaction |
| H15 | M5 | — | Core/HelperManager.swift:810 | Missing status field proves Core stopped | False positive: helper emits field; truncation rejected |
| H16 | M5 | — | Core/HelperManager.swift:1176 | Update Stage timeout cuts network | False positive: Stage precedes network mutation |
| H17 | M5 | — | Services/SupportDiagnostics.swift:82 | Diagnostics block the main actor | False positive: probes run detached |
| H18 | M5 | — | Core/HelperManager.swift:680 | Unbounded launchctl wait wedges cleanup | Unverified: ordinary trigger unproved |
| H19 | M5 | — | Core/HelperManager.swift:388 | Installer stderr pipe never closes | Unverified: surviving writer unproved |
| H20 | M5 | P2 | Core/HelperManager.swift:1210 | Undelivered upgrade polls for 45 seconds | Duplicate #759 |
| H21 | M5 | P1 | Core/RuntimeCleanup.swift:263 | Status timeout bypasses launch recovery | Duplicate #840 |
| H22 | M5 | P1 | Core/HelperManager.swift:259 | Abandoned upgrade leaves PF armed | Duplicate #794 |
| H23 | M7 | — | Services/Catalog/ManagedCatalogProcessor.swift:38 | Legacy custom nodes reject every catalog | False positive: different legacy storage; no migration |
| H24 | M7 | — | Services/Persistence/LocalRoutePreferences.swift:55 | Retired region prevents connection | False positive: only recommendations restricted |
| H25 | M7 | — | Services/AppState+LaunchProtection.swift:46 | Delayed status clears newer protection | False positive: sequence and generation guards |
| H26 | M5 | — | Core/RuntimeCleanup.swift:205 | First query bypasses rejection repair | False positive: ordinary signed replacement still accepted |
| H27 | M5 | — | Core/RuntimeCleanup.swift:360 | Unknown status leaves orphan Core running | False positive: requires additional lost state |
| H28 | M5 | — | Core/RuntimeCleanup.swift:374 | Cleared marker prevents DNS retry | False positive: two failures; original gap covered |
| H29 | M5 | — | Core/CoreRuntimeManager.swift:127 | Stale digest admits different runtime bytes | False positive: helper verifies snapshot hash |
| H30 | M5/M7 | — | Core/RuntimeCleanup.swift:97 | Failed marker deletion blocks launch | False positive: explicit Connect remains available |
| H31 | M7 | — | Services/AppState+Catalog.swift:537 | Corrupt metadata rejects policy refresh | Unverified: reachability unproved; refresh optional |
| H32 | M5 | P2 | Core/RuntimeCleanup.swift:224 | Protected Offline update cannot commit | Duplicate #795 |
| H33 | M5 | P2 | Core/RuntimeCleanup.swift:410 | Repair skips snapshotless DNS restoration | Duplicate #756 |
| H34 | M5 | — | Core/RuntimeCleanup.swift:365 | Launch Core stop removes AI blocking | False positive: watchdog applies selective hold |

**PRs:** none; labels and auto-merge are not applicable. No local-only product commits.

**34 hypotheses:** 22 false positives, 8 duplicates, 1 real-unfixed item, 3 unverified candidates.

All assigned files were reviewed. Native Swift/XCTest and PF/DNS verification could not run on Linux.

[Full report](/workspace/w1-codex/out/R3-M5M7/report.md) · [Findings log](/workspace/w1-codex/out/R3-M5M7/findings.tsv)