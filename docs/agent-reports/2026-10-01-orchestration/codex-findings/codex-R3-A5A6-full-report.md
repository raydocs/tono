Four fixes merged through CI: #1036, #1038, #1045, #1047. Each used MERGE auto-merge and carries needs-hardware. All ci-gate checks succeeded on their recorded heads. No deployment/publication performed.

| ID | area | severity | file:line | description | verdict |
|---|---|---|---|---|---|
| WIN-CATALOG-VANISH-AI-HOLD | A5/catalog sync | P1 | apps/windows/app/src-tauri/src/tono/connection/switch.rs:62 | Automatic vanished-exit release removes the secondary AI hold | real-fixed #1036 |
| R3-A5-OLD-CATALOG | A5 | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:374 | Older catalog response replaces a newer catalog | false-positive sync mutex and CatalogTracker reject stale revisions |
| R3-A5-STALE-LOGOUT | A5 | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:313 | Late catalog response commits after sign-out | false-positive auth generation checked before persistence |
| R3-A5-GRANT-TTL | A5 | — | apps/windows/app/src-tauri/src/tono/offline_grant.rs:241 | Offline grant expiry cuts general internet | false-positive no TTL by entitlement design; mismatch only gates Connect |
| R3-A5-VERDICT | A5 | — | apps/windows/app/src-tauri/src/tono/offline_grant.rs:566 | Old refusal suspends replacement account | false-positive identity epoch compared before application |
| R3-A5-ROAMING-TOKEN | A5 | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:685 | Roaming identity rebind restores old token | false-positive vault lock rereads current token |
| R3-A5-POLICY-ACCOUNT | A5 | — | apps/windows/app/src-tauri/src/tono/policy_sync.rs:40 | Traffic policy leaks across account replacement | false-positive signed traffic policy is global; issue #317 differs |
| R3-A5-ACCOUNT-CANCEL | A5 | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:575 | Cancelled sign-out leaves orphan account teardown | false-positive detached close slot and release coordinator preserve ownership |
| R3-A5-STALE-CACHE | A5 | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:146 | New sign-in uses previous account cache after delete failure | false-positive needs delete plus offline sync failure; token-bound grant refuses |
| WIN-REPLACEMENT-HEAL-STATE | A5 | P2 | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Replacement sign-in retains previous account healer dial state | real-fixed #1047 |
| WIN-GRANT-FLUSH-QUEUE | A5 | P2 | apps/windows/app/src-tauri/src/tono/offline_grant.rs:512 | Timed-out grant flushes fill vault queue after a prolonged stall | real-unfixed P2 prolonged vault stall; rejected token rotation can outlast recovery |
| R3-A5-CONNECTING-ROUTING | A5 | P2 | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:346 | Residential catalog rotation during Connecting leaves stale runtime | duplicate known #787 limitation |
| WIN-IDLE-QUIT-IPC-DELAY | A6 | P1 | apps/windows/app/src-tauri/src/feat/window.rs:538 | Optional idle-Service shutdown can silently delay Quit up to 127 seconds | real-fixed #1038 |
| WIN-STARTUP-AUTH-SUPERSESSION | A6 | P2 | apps/windows/app/src-tauri/src/tono/commands/restore.rs:128 | Boot preflight can supersede a newer interactive sign-in | real-fixed #1045 |
| R3-A6-QUIT-RESTORE | A6 | — | apps/windows/app/src-tauri/src/tono/commands/restore.rs:210 | Late startup restore rearms after Quit | false-positive connection epoch and current runtime proof gate reconnect |
| R3-A6-COMMITTED-HANG | A6 | — | apps/windows/app/src-tauri/src/lib.rs:657 | Committed exit hangs indefinitely | false-positive ten-second outer cleanup budget |
| R3-A6-WATCHDOG-CANCEL | A6 | — | apps/windows/app/src-tauri/src/lib.rs:286 | Cancelled Quit disables recovery watchdog | false-positive affected watchdog is diagnostic only |
| R3-A6-MISSING-STATE | A6 | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:303 | Missing TonoState prevents every quit release | false-positive state-independent owner release and init retries exist |
| R3-A6-SILENT-WINDOW | A6 | — | apps/windows/app/src-tauri/src/resolve/window.rs:159 | Silent boot nevertheless shows window | false-positive silent startup does not create main window |
| R3-A6-CORE-CLEANUP | A6 | — | apps/windows/app/src-tauri/src/feat/window.rs:558 | Core cleanup is indefinitely unbounded | false-positive finite IPC guard; noncancellation deliberate |
| R3-A6-PROXY-SINGLETON | A6 | P3 | apps/windows/app/src-tauri/src/utils/server.rs:100 | Singleton notify inherits proxy | duplicate #984 |
| WIN-FAILED-PREPARE-AI-HOLD | A6 | P1 | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:267 | Automatic failed-Prepare release discards narrow intent through pending-update Disconnect | duplicate #1040; independently reproduced, own alternate branch not submitted |
| R3-A6-LEGACY-PREPARE | A6 | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:141 | Legacy update cleanup leaves protection stranded | false-positive command unregistered and no production caller |
| R3-A6-ADOPT-INCOMPLETE | A6 | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:346 | Failed Adopt latches INCOMPLETE | duplicate BRICK-W10 |
| R3-A6-MANUAL-LEASE | A6 | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:364 | Manual lease refuses pending update release | duplicate BRICK-W2/BRICK-W5 |
| R3-A6-SPAWN-FAIL | A6 | P1 | apps/windows/app/src-tauri/src/tono/commands/update.rs:208 | Executor spawn failure retains bootstrap block | duplicate fixed #961 |
| R3-A6-PREPARE-STOP | A6 | P1 | apps/windows/app/src-tauri/src/tono/commands/update.rs:195 | Prepare error after Core stop retains block | duplicate fixed #793 |
| R3-A6-QUIT-POLLING | A6 | P2 | apps/windows/app/src-tauri/src/tono/commands/quit.rs:452 | Cancelled Quit loses catalog sync | duplicate fixed #784 |
| R3-A6-UPDATE-OFFER | A6 | — | apps/windows/app/src-tauri/src/tono/commands/update.rs:107 | Older update Check overwrites newer offer and installs downgrade | false-positive selected hash and Service release-sequence floor guard install |
| R3-A6-STALE-COMPENSATION | A6 | — | apps/windows/app/src-tauri/src/tono/commands/update.rs:183 | Stale connection cleanup releases update-owned barrier | false-positive invalidation retains release_on_stale=false |
| WIN-UPDATE-CONNECTING-CLEANUP | A6 | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:277 | Failed update while Connecting omits immediate recovery | real-unfixed P2 ordinary operation overlap; watchdog caps recovery at seven minutes |
| WIN-UPDATE-TOKEN-FLUSH | A6 | P2 | apps/windows/app/src-tauri/src/tono/commands/update.rs:202 | Executor hard termination bypasses failed rotated-token exit flush | real-unfixed P2 two failures (vault write and update publication); late reopen beyond replay grace |

Hypotheses: 32; false positives: 17; duplicates: 8; fixed: 4; source-confirmed unfixed: 3.

PRs:
- [#1036](https://github.com/raydocs/tono/pull/1036): fix(windows): retain AI hold after catalog exit removal; MERGED, auto-merge yes (MERGE); needs-hardware; [green ci-gate](https://github.com/raydocs/tono/actions/runs/36813587214/job/110216954378).
- [#1038](https://github.com/raydocs/tono/pull/1038): fix(windows): bound optional Service shutdown during Quit; MERGED, auto-merge yes (MERGE); needs-hardware; [green ci-gate](https://github.com/raydocs/tono/actions/runs/36814134430/job/110218459410).
- [#1045](https://github.com/raydocs/tono/pull/1045): fix(windows): preserve interactive sign-in during startup restore; MERGED, auto-merge yes (MERGE); needs-hardware; [green ci-gate](https://github.com/raydocs/tono/actions/runs/36815623524/job/110223008103).
- [#1047](https://github.com/raydocs/tono/pull/1047): fix(windows): reset failover when replacing an account; MERGED, auto-merge yes (MERGE); needs-hardware; [green ci-gate](https://github.com/raydocs/tono/actions/runs/36816283278/job/110225169432).

All assigned files were read end to end with cross-file caller/callee tracing. Native real-machine WFP/DNS/TUN acceptance could not run. The three remaining lower-priority findings are confirmed by source tracing and lack native reproduction: prolonged vault queue stall; Connecting/update overlap bounded by the seven-minute fresh-arm watchdog; rotated-token persistence failure plus failed update publication followed by reopening beyond replay grace.

The pushed alternate branch hunt/sol-r3acct-update-stage-ai-hold at 8b9c555c is abandoned as duplicate #1040. Do not open or merge it. No failed pushes or blocked PR creations.

Local evidence: catalog exact-function regression red0/1 then green1/0; Quit portable regression red0/1 then green1/0; startup exact-helper/test with lightweight state fixture red0/1 then green1/0. Actual hosted native Tauri test steps passed on exact #1045/#1047 heads (metadata in startup-native-ci.json and account-heal-native-ci.json). The account-healer native regression was written before the reset, but native baseline execution was not runnable locally; no baseline native pass/fail claim is made. The abandoned update alternative independently reproduced dispatch red0/2 then green2/0 and strict WFP red0/1, and its actual Linux WFP suite passed108/0; that alternate code was not submitted.

Hunter: GPT-6.1 Sol (Codex CLI)
