# R4-RestoreDNS: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:48 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1076 | hunt/sol-r4dns-retired-snapshot | needs-hardware | yes | fix(windows): retire restored DNS snapshots before the next session |
| 1090 | hunt/sol-r4dns-scm-retire-release | needs-hardware | yes | fix(windows): complete SCM release after owner retirement write failure |
| 1099 | hunt/sol-r4dns-update-ai-release | needs-hardware | yes | fix(macos): retain AI hold through pending-update failure cleanup |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| REG-1033 | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:321 | Valid owner restore retries Apply before retiring snapshot | ok; snapshotless sibling issue #1063 |
| REG-1030 | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:987 | Preferences mutation refuses contended locks promptly | ok |
| REG-765 | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:147 | Protected DNS save/load/write caps agree and foreign reads are uncapped | ok |
| REG-756 | macOS launch DNS | — | apps/macos/Tono/Core/RuntimeCleanup.swift:448 | Available repaired helper always receives snapshotless restore | ok |
| MAC-SELECTIVE-RESOLVER-OWNERSHIP | macOS DNS | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:171 | Selective layer deletes and overwrites foreign resolver files | real-unfixed issue #1062; native ownership/recovery contract needed |
| MAC-DNS-SNAPSHOTLESS-APPLY-RETRY | macOS DNS | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | Snapshotless retry skips activation after successful Commit and failed Apply | real-unfixed issue #1063; two failures and native qualification required |
| WIN-DNS-RETIRED-SNAPSHOT-REPLAY | Windows DNS | P2 | apps/windows/service/src/core/dns/mod.rs:2852 | Restored but retained adapter snapshot replays old session originals after DNS changes | real-fixed #1076 (merged; CI passed) |
| DNS-CALLBACK-LIFETIME | Windows app DNS | P2 | apps/windows/app/src-tauri/src/tono/windows_dns.rs:39 | Published outcome lets waiter retire completion during callback | false-positive: callback-owned Arc lasts through notification |
| WIN-IDLE-TOMBSTONE-DNS-SKIP | Windows WFP/DNS | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2764 | Idle tombstone write error appears to skip DNS restore | false-positive: ordinary release handler restores DNS first; SCM scenario needs previous restore failure |
| WIN-FAILED-START-STRICT-ROLLBACK | Windows WFP | P2 | apps/windows/service/src/core/server/handlers.rs:765 | StartClash failure rollback appears to release strict protection | false-positive: preceding successful bootstrap arm is always non-strict |
| WIN-SCM-RETIREMENT-FAILURE-RELEASE | Windows WFP/DNS | P1 | apps/windows/service/src/core/server/mod.rs:607 | Owner retirement write failure skips proven SCM stop release and leaves persistent broad WFP | real-fixed #1090 (awaiting CI/merge) |
| MAC-DNS-DOUBLE-RESTORE-FOREIGN-LOOPBACK | macOS DNS | P2 | apps/macos/Tono/Services/KillSwitchService.swift:333 | Second normal Disconnect restore loses owner evidence and clears a foreign loopback resolver | real-unfixed issue #1097; ownership/recovery contract and native end-to-end qualification required |
| MAC-UPDATE-RECOVERY-AI-HOLD | macOS PF/update | P1 | apps/macos/Tono/Services/AppState+Connect.swift:724 | Pending-update gate discards automatic failure release intent and removes AI hold | real-fixed #1099 (awaiting CI/merge) |
| REG-712 | macOS DNS | P2 | apps/macos/Tono/Services/KillSwitchService.swift:333 | Second app restore defeats owner-only helper restoration | issue #1097 |
| REG-738 | Windows/macOS selective DNS | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:171 | Windows release ordering survives; mac resolver ownership is missing | issue #1062 |
| REG-740 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2949 | Wanted-Core proof deadline releases non-strict abandoned recovery | ok |
| REG-753 | Windows WFP | — | apps/windows/service/src/core/wfp_model.rs:848 | Intent permits persist and failed startup removal retries | ok |
| REG-761 | macOS PF | — | tooling/scripts/core-helper/KillSwitchManager.swift:664 | Placeholder failure cannot prevent release or reload stale rules | ok |
| REG-769 | Windows DNS/WFP | P2 | apps/windows/service/src/core/dns/mod.rs:2895 | Retained restored snapshot can replay previous session originals | regression-fixed #1076 |
| REG-777 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3648 | Committed DIRECT expiry releases non-strict sessions after retraction | ok |
| REG-792 | Windows SCM/WFP | P1 | apps/windows/service/src/core/server/mod.rs:607 | Owner retirement error skipped proven SCM release | regression-fixed #1090 |
| REG-793 | Windows update | — | apps/windows/service/src/core/update.rs:325 | Failed Prepare preserves recovery obligation and AI disposition | ok |
| REG-812 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2067 | Tunnel lock retains shared armed_guard poison recovery | ok; poison regression passed in WFP suite |
| REG-858 | Windows update | — | apps/windows/service/src/bin/install_service/update_executor.rs:612 | Failed restart selectively releases after strict/lifecycle rechecks | ok |
| REG-889 | macOS PF | — | tooling/scripts/core-helper/KillSwitchManager.swift:375 | Only accepted or ambiguous partial PF loads receive automatic release | ok |
| REG-974 | Windows WFP/AI | — | apps/windows/service/src/core/windows_kill_switch.rs:3127 | Automatic release adds AI floor after broad WFP removal | ok |
| REG-976 | Windows WFP/AI | — | apps/windows/service/src/core/windows_kill_switch.rs:1322 | Failed replacement keeps predecessor AI hold | ok |
| REG-986 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:622 | Startup retry retains reconnect-bearing tombstone | ok |
| REG-988 | Windows AI recovery | — | apps/windows/service/src/core/selective_layer.rs:75 | Native selective mutations serialize latest disposition after timeout | ok |
| REG-1005 | Windows WFP/AI | — | apps/windows/service/src/core/windows_kill_switch.rs:3545 | Unverified first-connect cleanup retains AI and rejects strict retirement | ok |
| REG-1014 | Windows SCM/AI | — | apps/windows/service/src/core/windows_kill_switch.rs:3018 | Armed stop applies AI hold and idle stop preserves prior disposition | ok |
| REG-1021 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:440 | Fresh expiry drops WFP lock before lifecycle lock and fences successors | ok |
| REG-1024 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2878 | Explicit release clears crash-record and reconnect retries | ok |
| REG-1028 | macOS PF/AI | — | tooling/scripts/core-helper/KillSwitchManager.swift:644 | Automatic failed commits apply AI floor after broad release | ok |
| REG-1029 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:576 | Ownerless retry yields to valid or strict fresh intent | ok |
| REG-1032 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:309 | Core exhaustion is epoch-fenced and cleanup avoids joined watchdog | ok |
| REG-1037 | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:4102 | Inherited verification cannot acknowledge fresh-arm proof | ok |
| REG-1044 | Windows WFP/AI | — | apps/windows/service/src/core/windows_kill_switch.rs:3648 | DIRECT expiry invokes one selective follow-up | ok |
| REG-1048 | macOS PF/update | P1 | apps/macos/Tono/Services/AppState+Connect.swift:724 | Pending-update diversion dropped automatic AI-preserving intent | regression-fixed #1099 |
| REG-989 | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:580 | Live restore normalizes saved separators while registry originals stay raw | ok |
| REG-987 | Windows DNS | — | apps/windows/service/src/core/dns/engine.rs:536 | New-adapter DoH captures append before suppression and keep originals | ok |
| REG-985 | Windows DNS | — | apps/windows/service/src/core/dns/engine.rs:412 | Restored encrypted captures retire before reuse and recapture precedes suppression | ok |
| REG-868 | Windows DNS | — | apps/windows/service/src/core/dns/engine.rs:843 | IPv4 CIM84 does not skip IPv6 or waive effective readback | ok |
| REG-844 | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:3281 | Update observation avoids orphan healing beneath wanted WFP | ok |
| REG-841 | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:531 | Writer owns self-write window until mutation actually completes | ok |
| REG-828 | Windows app DNS | — | apps/windows/app/src-tauri/src/tono/windows_dns.rs:39 | Callback storage survives result consumption and notification | ok |
| REG-754 | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:1082 | GUID membership/proof ignores casing without changing engine result identity | ok |
| REG-902 | Windows SCM | — | apps/windows/service/src/bin/service.rs:403 | Stop checkpoints continue through bounded cleanup and join before final Stopped | ok |
| REG-978 | Windows update DNS/WFP | — | apps/windows/service/src/bin/install_service/update_executor.rs:599 | Failed update recovery selects narrow emergency release after strict/owner checks | ok |
| REG-1040 | Windows update DNS/WFP | — | apps/windows/service/src/core/update.rs:646 | Pending update automatic Disconnect retains narrow AI intent | ok |
| MAC-DNS-OWNER-DOUBLE-WRITE | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | One owner restore appeared to write originals twice | false-positive: owner write makes the loopback-only sweep skip it; valid-snapshot reapply is intentional |
| MAC-DNS-FOREIGN-COUNT-RESTORE | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:880 | Foreign resolver list over32 appeared to block restoration | false-positive: normal SC reads are uncapped; enable rejects its own oversized capture before mutation |
| MAC-DNS-LOCK-FALLBACK | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:796 | Legacy name fallback appeared to bypass nonblocking lock | false-positive: ID-bearing paths use ID I/O; fallback also needs independent enumeration failure |
| MAC-AI-HOLD-ARM-INTERLEAVE | macOS PF | — | tooling/scripts/core-helper/KillSwitchManager.swift:568 | Late selective installer appeared to overwrite a new arm | false-positive: arm lock and guarded follow-up serialize disposition |
| MAC-LAUNCH-REPAIR-SNAPSHOTLESS | macOS launch DNS | — | apps/macos/Tono/Core/RuntimeCleanup.swift:448 | Launch repair appeared to skip snapshotless restore | false-positive: merged #756 requests restore after available status |
| MAC-DNS-RENAMED-STATUS | macOS DNS | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:569 | DNS status reads stale display name despite stable ID | duplicate of open #979 and issue #893 |
| WFP-CORE-LOCK-CYCLE | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:125 | WFP-held identity lookup appeared to take Core manager lock | false-positive: identity is a packed atomic snapshot |
| WFP-FRESH-EXPIRY-SUCCESSOR | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3739 | Expired cleanup could remove successor protection | false-positive: WFP lock dropped before lifecycle lock and epoch checked twice |
| WFP-OLD-EXHAUSTION-SUCCESSOR | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:309 | Old exhaustion could poison a new connection | false-positive: matching epoch required before proof-state mutation |
| WFP-EXPLICIT-STALE-CRASH-RETRY | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2878 | Crash retry could resurrect reconnect after explicit release | false-positive: both branches clear retry and reconnect state |
| WFP-OWNERLESS-RETRY-FRESH-ARM | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:595 | Ownerless retry could delete a fresh arm | false-positive: ARMED and newer valid/strict intent terminate retry under WFP lock |
| WFP-DIRECT-DOUBLE-AI-HOLD | Windows AI recovery | — | apps/windows/service/src/core/windows_kill_switch.rs:3688 | DIRECT expiry could delete its fresh AI hold | false-positive: #1044 removed redundant follow-up |
| WFP-INHERITED-FRESH-PROOF | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:4102 | Inherited durable verification could hide missing fresh proof | false-positive: #1037 excludes pending fresh proof |
| WFP-FAILED-ARM-AI-REMOVAL | Windows AI recovery | — | apps/windows/service/src/core/windows_kill_switch.rs:1322 | Failed install could remove existing AI hold | false-positive: removal follows successful install and exact verification |
| WFP-IDLE-STOP-AI-REAPPLY | Windows SCM/AI | — | apps/windows/service/src/core/windows_kill_switch.rs:3018 | Idle stop could undo explicit Restore disposition | false-positive: idle branch preserves current state |
| WFP-UNVERIFIED-STRICT-RETIRE | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3559 | Unverified startup retirement could release strict mode | false-positive: explicit strict intent returns before retirement/disarm |
| MAC-UPDATE-REPEATED-AI-APPLY | macOS emergency PF/DNS | — | tooling/scripts/core-helper/UpdateExecutor.swift:83 | Combined update failure releases appeared to conflict by applying selective floor twice | false-positive: identical resolver/routes are idempotent; no broad PF rearm or repeated DNS restore; ownership issue separate #1062 |
| MAC-PF-X-REFERENCE-LOSS | macOS PF | P2 | tooling/scripts/core-helper/KillSwitchPF.swift:1279 | Nonzero pfctl release can discard reference token | duplicate of #979 and known #895 |
| MAC-LAN-DNS-NIC-SCOPE | macOS PF | P2 | tooling/scripts/core-helper/KillSwitchPF.swift:165 | LAN DNS scope can remain stale after a new NIC | duplicate of #979 and known #894 |
| MAC-RESOLVER-SIGKILL-WAIT | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchPF.swift:1763 | Resolver child wait after SIGKILL remains unbounded | concern: native unkillable-child failure not proved |
| WFP-STRICT-WATCHDOG-RELEASE | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:3117 | Strict unhealthy watchdog eventually releases | false-positive: existing deliberate decision027; no reviewed fix introduced it |
| WFP-SELECTIVE-DOH-COVERAGE | Windows AI recovery | — | apps/windows/service/src/core/selective_layer.rs:145 | Secondary domain hold lacks arbitrary DoH/shared cached CDN coverage | false-positive: documented decision036 best-effort boundary; no new regression |
| WIN-UPDATE-ROLLBACK-DOUBLE-HOLD | Windows update/AI | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:628 | Failed rollback restart can replace the AI floor twice | duplicate of R3REGW-ROLLBACK-DOUBLE-HOLD issue #1055 |
| MAC-UPDATE-SINGLE-FLIGHT-DISPOSITION | macOS update/AI | P2 | apps/macos/Tono/Services/AppState+NativeUpdate.swift:67 | Explicit Restore overlaps selective automatic cleanup | concern: removal may require retry; no native timing evidence, normal network and AI remain available/held |
| WIN-DNS-RETIREMENT-UNPROVEN-SKIP | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:2796 | Retirement digest might waive unproven DNS restoration | false-positive: retirement follows accepted proof/policy cleanup; snapshotless safety still checked |
| WIN-DNS-LATE-RETIREMENT-MARKER | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:2924 | Late retirement write might retire a newer session | false-positive: exact saved-byte digest binds marker; no single-failure match proved |
| WIN-DNS-UNREADABLE-RETIREMENT | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:352 | Unreadable retirement record might refuse normal restore | false-positive: unreadable optional marker falls back to full proof |
| WIN-DIRECT-RENEW-EXPIRY-SIBLING | Windows WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2643 | Renew may consume expiry before watchdog release | false-positive as single-failure outage: live App monitor owns recovery; losing it needs another failure |
| WIN-DNS-GUID-FAILURE-BOOKKEEPING | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:2392 | Case-normalized restore might lose failure flags | false-positive: engines return caller/snapshot GUID spelling |
| WIN-DNS-INSESSION-ORPHAN-POLICY | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:807 | Hotplug healing might restore DoH policy during protection | false-positive: InSession scope touches supplied adapters and never restores encrypted policy |
| WIN-DNS-CIM84-FALSE-CONFIRMATION | Windows DNS | — | apps/windows/service/src/core/dns/engine.rs:843 | CIM84 could waive protection proof | false-positive: independent native family verifier preserves failed obligations |
| WIN-DNS-CAPTURE-LOSS-CONSUMED | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:2357 | Lost-originals warning may vanish after policy failure | false-positive: durable capture-loss and settle handoff survive retries |
| WIN-DNS-LIVE-PROOF-REGISTRY | Windows DNS | — | apps/windows/service/src/core/dns/engine.rs:1389 | Registry proof is incomplete live DNS proof | duplicate of BRICK-W7; no new native evidence |
| WIN-DNS-LEGACY-V6-OWNERSHIP | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:807 | Snapshotless ::1 cannot distinguish old Tono from foreign resolver | duplicate of WIN-DNS-LEGACY-V6-RESIDUE ownership decision |
| WIN-DNS-SNAPSHOT-REFRESH-RESTORE | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:2813 | Refreshed snapshot write can refuse restored release | duplicate of open #982 |
| WIN-DNS-SNAPSHOT-DELETE-RELEASE | Windows DNS | — | apps/windows/service/src/core/dns/mod.rs:2895 | Deletion failure refuses a proven release | duplicate of #769/open #827; replay is separate #1076 |
| WIN-DNS-NRPT-OBSERVATION-WORKERS | Windows DNS | P2 | apps/windows/service/src/core/dns/engine.rs:1793 | Timed-out native NRPT reads can accumulate blocking workers | concern: native permanent hang unverified; predates tonight and shutdown does not wait |
| WIN-APP-DNS-DETECTOR-RESTORE-MUTATION | Windows app DNS | — | apps/windows/app/src-tauri/src/tono/encrypted_dns.rs:41 | App detector might own persistent DNS mutations | false-positive: detectors are read-only; Service owns policy captures |
| WIN-APP-BROWSER-HEALTH-FULL-RELEASE | Windows app DNS | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1408 | Browser health cleanup might release AI protection | false-positive: automatic cleanup selects narrow release |
| WIN-APP-BROWSER-PREFLIGHT-ARM | Windows app DNS | — | apps/windows/app/src-tauri/src/tono/connection.rs:425 | Browser preflight rejection might leave a new arm | false-positive: initial check precedes arm; recovery uses narrow cleanup |
| WIN-APP-DNS-PROVIDER-WORKERS | Windows app DNS | P2 | apps/windows/app/src-tauri/src/tono/windows_dns.rs:67 | Provider omitting mandatory cancellation callback retains worker | concern: external native provider contract failure unverified |
| REG-866 | Windows DNS/WFP | — | apps/windows/service/src/core/server/handlers.rs:13 | Failed Core-stop compensation only reintroduces tunnel DNS while Core stop is unconfirmed | ok |
| REG-873 | Windows DNS/WFP | — | apps/windows/service/src/core/server/mod.rs:362 | Ownerless release stops supervised Core and retires runnable metadata before filter release | ok |
| REG-955 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:463 | Accepted goodbye reserves lifecycle across listener restarts and teardown bypasses admission | ok |
| REG-1074 | Windows DNS/WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:451 | Committed DIRECT expiry fences late proof and retires Core/routes before selective fallback | ok |
| WIN-DIRECT-EXPIRY-PROOF-CLEARS-RETIREMENT | Windows DNS/WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:2962 | Late proof might cancel queued DIRECT retirement | false-positive: fresh pending suppresses proof; stale verification refused; only new-arm epoch revokes predecessor |
| WIN-GOODBYE-RESERVATION-BLOCKS-TEARDOWN | Windows Service | — | apps/windows/service/src/core/server/mod.rs:463 | Process-lifetime goodbye flag might refuse its own teardown | false-positive: teardown bypasses admission; flag rejects only new work |
| WIN-UNRECORDED-STOP-DNS-COMPENSATION | Windows DNS/WFP | P2 | apps/windows/service/src/core/server/handlers.rs:464 | Ownerless stop error skips active-owner DNS compensation | concern: needs missing/corrupt owner plus failed stop; deliberate ownership fail-closed and no native proof |
| REG-794 | macOS helper/PF | P2 | apps/macos/Tono/Core/HelperManager.swift:259 | Abandoned helper replacement uses explicit release and drops recent-helper AI hold | issue #1071; already reported by another hunter |
| MAC-HELPER-UPGRADE-AI-RELEASE | macOS helper/PF | P2 | apps/macos/Tono/Core/HelperManager.swift:259 | Post-stop automatic helper upgrade refusal uses explicit disarm | duplicate of issue #1071; capability-aware legacy cleanup needed |
| REG-1064 | macOS update retirement | — | tooling/scripts/core-helper/UpdateTransaction.swift:409 | Resolved retirement cleans executor job before clearing durable retry owner | ok |
| REG-971 | macOS emergency DNS/PF | — | tooling/scripts/core-helper/UpdateExecutor.swift:83 | Unreadable-ledger/failure release restores DNS and retains AI floor | ok; duplicated selective apply is idempotent |
| REG-991 | macOS update suspension | — | apps/macos/Tono/Services/AppState+NativeUpdate.swift:44 | Suspension fences cancelled reload callbacks and drains owners before retirement | ok |
| REG-773 | macOS orphan recovery | — | tooling/scripts/core-helper/SocketServer.swift:328 | Dead-owner bootstrap stops Core, releases PF, preserves AI and restores DNS | ok; pending-update exclusion retained |
| MAC-UPDATE-RETIRE-LOCK-CYCLE | macOS update cleanup | — | tooling/scripts/core-helper/UpdateStorage.swift:70 | Executor retirement while holding update lock appeared to deadlock a waiting executor | false-positive: lock wait is nonblocking and SIGTERM-aware; retirement requires verified Disconnect/native unprotected proof |
