# R4-MacHelperDeep: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:15 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1110 | hunt/sol-r4mh-selective-route-gateway | needs-hardware | yes | fix(macos): supply gateways for selective AI blackhole routes |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4MH-SELECTIVE-ROUTE-GATEWAY | macOS helper | P1 | tooling/scripts/core-helper/SelectiveFailOpen.swift:87 | Automatic AI fallback omits gateway in both blackhole adds; Darwin rejects every route | real-fixed #1110 |
| R4MH-RESOLVER-OWNERSHIP | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:168 | Secondary hold overwrites/deletes preexisting resolvers | duplicate #1062 |
| R4MH-RELEASE-INTERRUPTED | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:703 | Release interruption loses durable AI hold intent | duplicate #1078 |
| R4MH-PF-TOKEN-FORGET | macOS helper | P3 | tooling/scripts/core-helper/KillSwitchPF.swift:1268 | Failed token release forgets its recovery record | duplicate #895 / #979 |
| R4MH-LAN-NIC-SCOPE | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchPF.swift:170 | LAN DNS scope misses new physical NIC | duplicate #894 / #979 |
| R4MH-SINKHOLE-CACHE-LIMIT | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:159 | DNS hold cannot cover cached/literal/DoH traffic alone | duplicate accepted SFO-1; IP route omission separately fixed #1110 |
| R4MH-ARM-EARLY-HOLD-REMOVE | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:366 | Arm removes AI hold before broad protection commits | false-positive removal follows successful PF commit |
| R4MH-POWER-LOCK-INVERSION | macOS helper | — | tooling/scripts/core-helper/HelperPower.swift:124 | Power/PF/Core lock ordering deadlocks | false-positive gate released before PF and PF released before core; socket mutations serialize |
| R4MH-STATUS-RESURRECTS-PF | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:747 | Status re-arms after release | false-positive status read-only; supervisor only while Core running |
| R4MH-STALE-TUNNEL-RESTORE | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:972 | Restored stale tunnel permits survive dead Core | false-positive live-interface filter and dead-Core watchdog fence it |
| R4MH-WITHHOLD-STATE-LEAK | macOS helper | — | tooling/scripts/core-helper/KillSwitchPF.swift:646 | Withhold keep-state leaks AI to physical NIC | false-positive deliberate #608; no demonstrated AI leak from interface-bound TUN states |
| R4MH-BOOT-REARMS-STATE | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:951 | Boot restores obsolete broad PF block | false-positive no startup re-arm; stopped-Core startup release |
| R4MH-LOOKUP-UNINTERRUPTIBLE | macOS helper | — | tooling/scripts/core-helper/KillSwitchPF.swift:1763 | System lookup stays hung after SIGKILL | false-positive no realistic uninterruptible native trigger proved |
| R4MH-D01 | macOS helper | P2 | tooling/scripts/core-helper/CoreManager.swift:391 | Stale PID reused before SIGKILL | duplicate #897 / #979 |
| R4MH-D02 | macOS helper | P2 | tooling/scripts/core-helper/SocketServer.swift:645 | Silent upgrade opens FIFO before type validation | duplicate #928 / #979 |
| R4MH-D03 | macOS helper | P2 | tooling/scripts/core-helper/main.swift:1350 | Config FIFO blocks atomicCopy | duplicate #763 |
| R4MH-D04 | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:569 | DNS status resolves renamed service by display name | duplicate #893 / #979 |
| R4MH-D05 | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | Snapshotless restore retry skips Apply | duplicate #1063 |
| R4MH-D06 | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:361 | Second DNS restore clears foreign loopback resolver | duplicate #1097 |
| R4MH-D07 | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:138 | First enable discards foreign exact-loopback original | duplicate BRICK-M12 / MAC-DNS-OWNED-SNAPSHOT |
| R4MH-F01 | macOS helper | — | tooling/scripts/core-helper/HelperPower.swift:144 | Sleep watchdog bypasses wake barrier | false-positive suspension adds no ticks; wake reasserts before opening gate |
| R4MH-F02 | macOS helper | — | tooling/scripts/core-helper/CoreManager.swift:254 | Diagnostic close races active callback and crashes | false-positive unverified Darwin cancellation semantics; no native reproduction |
| R4MH-F03 | macOS helper | — | tooling/scripts/core-helper/CoreManager.swift:187 | Rejected sync config disrupts healthy Core | false-positive validation precedes old Core stop |
| R4MH-F04 | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:556 | Transient status failure suppresses DNS recovery forever | false-positive idle loop retries status and restores retained snapshot |
| R4MH-F05 | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:143 | Extra orphan threshold tick strands bootstrap | false-positive release remains bounded/eventual; comment timing discrepancy |
| R4MH-F06 | macOS helper | — | tooling/scripts/core-helper/HelperHTTP.swift:67 | Drip-fed request indefinitely suppresses watchdog | false-positive signed local peer required; no production trigger established |
| R4MH-F07 | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:439 | Empty service enumeration loses recovery permanently | false-positive later populated enumeration resolves ownership; evidence retained |
| R4MH-F08 | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:1063 | networksetup fills undrained pipe and hangs | false-positive no realistic over-capacity native output demonstrated |
| R4MH-F09 | macOS helper | — | tooling/scripts/core-helper/HelperPower.swift:22 | Nested power/Core/PF observations deadlock | false-positive sleep releases gate first; socket mutations serialize |
| R4MH-U01 | macOS helper | P2 | tooling/scripts/core-helper/UpdatePackage.swift:151 | Package FIFO hangs staging | duplicate #763 |
| R4MH-U02 | macOS helper | P2 | tooling/scripts/core-helper/UpdateTransaction.swift:44 | Installed update floor reread after seal verification | duplicate #896 / #979 |
| R4MH-U03 | macOS client | P2 | apps/macos/Tono/Models/UpdateContractV1.swift:164 | Protected Offline update cannot commit after startup release | duplicate #795 |
| R4MH-U04 | macOS helper | P1 | tooling/scripts/core-helper/UpdateRuntime.swift:95 | Pending-update automatic cleanup removes AI hold | duplicate #1099 |
| R4MH-U05 | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:703 | Interrupted automatic release loses durable disposition | duplicate #1078 |
| R4MH-U06 | macOS client | P2 | apps/macos/Tono/Core/HelperManager.swift:259 | Abandoned legacy upgrade removes AI hold | duplicate #1071 |
| R4MH-U07 | macOS helper | P2 | tooling/scripts/core-helper/UpdateTransaction.swift:409 | Retirement clears retry owner before cleanup | duplicate fixed #1064 |
| R4MH-U08 | macOS helper | — | tooling/scripts/core-helper/HelperPower.swift:15 | Update execute/commit nested power observations deadlock | false-positive recursive power lock |
| R4MH-U09 | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:429 | Same-FD flock allows concurrent ledger mutations | false-positive one socket dispatch thread; power does not mutate ledger |
| R4MH-U10 | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:243 | Prepare failure leaves ordinary PF block permanently | false-positive stopped-Core watchdog still releases after threshold |
| R4MH-U11 | macOS helper | — | tooling/scripts/core-helper/UpdateExecutor.swift:255 | Rollback leaves permanent ordinary PF block | false-positive restarted helper releases stopped-Core state and applies AI hold |
| R4MH-U12 | macOS client | — | apps/macos/Tono/Core/PrivilegedRuntimeCoordinator.swift:24 | Native preparation leaves system proxy active | false-positive coordinator disables proxy before prepare/disconnect |
| R4MH-U13 | macOS helper | — | tooling/scripts/core-helper/UpdateTransaction.swift:166 | Lost execute ACK authorizes a second forward installation | false-positive consumed/high-water persisted; repair stays same attempt |
| R4MH-U14 | macOS helper | — | tooling/scripts/core-helper/UpdateTransaction.swift:233 | Dead successor permanently locks adoption grant | false-positive reconcile rebinds after recorded successor dies |
| R4MH-U15 | macOS helper | — | tooling/scripts/core-helper/UpdateExecutor.swift:255 | Interrupted replacement executes forward again | false-positive replacing/rollingBack resumes rollback only |
| R4MH-U16 | macOS helper | — | tooling/scripts/core-helper/UpdatePackage.swift:203 | Native stage stall blocks cleanup/watchdog under update lock | false-positive unique single-failure trigger unproved; healthy Core remains during ordinary staging; FIFO duplicate #763 |
| R4MH-U17 | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:203 | SIGTERM permanently strands ordinary PF/DNS | false-positive ordinary restart repairs; permanent case needs admin unload or second failed restart; update-owned stop deliberate |
| R4MH-C01 | macOS client | — | apps/macos/Tono/Core/HelperProtocolVersion.swift:363 | Helper/app contract hash or version drift | false-positive shared version source and exact19-source CONTRACT agree |
| R4MH-C02 | macOS client | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:129 | Unverified stop permits a conflicting replacement Core | false-positive start admission refuses live owned Core and retry requires proof |
| R4MH-C03 | macOS client | — | apps/macos/Tono/Core/HelperManager.swift:1314 | Truncated helper reply is accepted as mutation success | false-positive complete valid JSON envelope required; malformed/truncated bodies fail |
| R4MH-C04 | macOS client | — | apps/macos/Tono/Core/PrivilegedRuntimeCoordinator.swift:6 | Blocking helper operations run on UI main actor | false-positive independent actor executor; no awaited reentrancy within synchronous IPC transaction |
| R4MH-C05 | macOS client | — | apps/macos/Tono/Core/RuntimeCleanup.swift:447 | Stale app intent re-arms after helper confirms release | false-positive authenticated released observation clears local intent before reassert |
| R4MH-C06 | macOS client | — | apps/macos/Tono/Core/HelperManager.swift:1452 | Helper client FIFO validation hangs machine | false-positive user-owned bundle replacement required; no normal signed resource trigger, helper FIFO already #979 |
| R4MH-RUNTIME-KEY-AMBIGUITY | macOS helper | P2 | tooling/scripts/core-helper/main.swift:269 | Ambiguous JSON keys differ between helper and Go decoder | duplicate fixed H10-F2 / #417 |
| R4MH-STARTUP-FAIL-DNS | macOS helper | P2 | tooling/scripts/core-helper/main.swift:747 | Failed daemon startup leaves protected DNS stranded | duplicate #763 B |
| R4MH-CONFIG-FIFO | macOS helper | P2 | tooling/scripts/core-helper/main.swift:1352 | Config FIFO blocks atomicCopy | duplicate #763 C |
| R4MH-EMERGENCY-STALECORE | macOS helper | P2 | tooling/scripts/core-helper/main.swift:798 | Stale Core initialization aborts emergency release | duplicate #763 A |
| R4MH-UPDATE-STARTUP-CATCH | macOS helper | — | tooling/scripts/core-helper/main.swift:1537 | Outer executor startup catch strands network | false-positive executor catches internally and releases/restores DNS/AI |
| R4MH-RESET-PENDING-RELEASE | macOS helper | — | tooling/scripts/core-helper/main.swift:937 | Pending/corrupt ledger refuses emergency network release | false-positive removal refused but catch still emergency-disarms |
| R4MH-REMOVED-RELOCATED-LIVE-APP | macOS helper | — | tooling/scripts/core-helper/main.swift:1125 | Moved/renamed running app is mistaken for uninstall | false-positive candidate name + code identity/liveness preserve running app |
| R4MH-CONFIG-BYTES-SWAP | macOS helper | — | tooling/scripts/core-helper/main.swift:1405 | Input swap changes root-staged config without digest check | false-positive opened fd streamed then copied-byte hash validated |
| R4MH-APP-REMOVAL-DURING-UPDATE | macOS helper | — | tooling/scripts/core-helper/main.swift:1199 | App absence during replacement uninstalls active helper | false-positive pending attempt defers removal and repeats presence check under lock |
| R4MH-SIGNEDOUT-LAUNCH-AI-HOLD | macOS account caller | P2 | apps/macos/Tono/Services/Account/AccountSession+Auth.swift:41 | Signed-out cold launch removes automatic recovery AI hold | real-unfixed #1117 outside assigned account path; needs older-helper qualification |
| R4MH-S01 | macOS client | — | apps/macos/Tono/Core/HelperManager.swift:310 | Older app manually replaces newer helper | false-positive documented administrator install fallback |
| R4MH-S02 | macOS client | — | apps/macos/Tono/Core/HelperManager.swift:810 | Missing running field proves stopped | false-positive no current/known helper producer omits running |
| R4MH-S03 | macOS client | — | apps/macos/Tono/Core/RuntimeCleanup.swift:230 | External retirement leaves update flags latched | false-positive documented emergency flow requires reopen resetting flags |
| R4MH-S04 | macOS client | — | apps/macos/Tono/Core/HelperManager.swift:629 | launchctl stalls coordinator indefinitely | false-positive no unique ordinary native stall demonstrated |
| R4MH-S05 | macOS client | — | apps/macos/Tono/Core/RuntimeCleanup.swift:263 | Forbidden update status blocks identity repair | false-positive explicit unknown-update refusal; no normal authenticated rejection trigger |
| R4MH-S06 | macOS client | P2 | apps/macos/Tono/App/AppDelegate.swift:350 | Signal/Quit cleanup removes AI hold | duplicate #1052 decision item |
| R4MH-C07 | macOS client | — | apps/macos/Tono/Core/RuntimeCleanup.swift:315 | Captured resume survives helper repair and re-arms stale intent | false-positive current isArmed admission and account resume retirement fence it |
| R4MH-C08 | macOS client | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:180 | Synchronous stop stalls UI main actor | false-positive no production callers |
| R4MH-C09 | macOS client | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:216 | Async stop reports stopped after unverified failure | false-positive catch retains running unless helper confirms stopped |
| R4MH-C10 | macOS client | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:108 | Concurrent writer mislabels installed config digest | false-positive callers carry and verify returned digest; no new proved race |
