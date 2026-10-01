# R4-FailOpen: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:48 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1061 | hunt/sol-r4fo-browser-ai-hold | needs-hardware | yes | fix(macos): preserve AI hold during automatic cleanup |
| 1089 | hunt/sol-r4fo-selective-system-dir | needs-hardware | yes | fix(windows): bind selective firewall commands to OS directory |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| REG-1044 | Windows Service | - | core/windows_kill_switch.rs | Single DIRECT expiry AI hold avoids redundant native reconciliation | ok |
| REG-1040 | Windows Service | - | core/server/mod.rs | Pending-update stop failure now carries automatic narrow disposition | ok |
| REG-1037 | Windows Service | - | core/windows_kill_switch.rs | Fresh-arm status masks inherited verified bit until current proof | ok |
| REG-1032 | Windows Service | - | core/manager.rs | Core exhaustion atomically queues wanted lifecycle cleanup | ok |
| REG-1029 | Windows Service | - | core/windows_kill_switch.rs | Ownerless and unreadable startup release retries stay cancelable | ok |
| REG-1024 | Windows Service | - | core/windows_kill_switch.rs | Crash tombstone replacement cancels stale cleanup on a new arm | ok |
| REG-1014 | Windows Service | P2 | core/windows_kill_switch.rs:2812 | SCM stop chooses AI hold but durable tombstone forgets its requested disposition | issue #1077 |
| REG-1005 | Windows Service | - | core/windows_kill_switch.rs | Interrupted first attempt keeps AI hold and excludes explicit strict | ok |
| REG-988 | Windows Service | P2 | core/selective_layer.rs:42 | Native selective work is serialized but six-second wait can outlive Service teardown | issue #1077 |
| REG-986 | Windows Service | - | core/windows_kill_switch.rs | Startup retry retains crash reconnect tombstone | ok |
| REG-976 | Windows Service | - | core/windows_kill_switch.rs | Failed broad WFP installation retains preexisting narrow hold | ok |
| REG-974 | Windows Service | - | core/windows_kill_switch.rs | Automatic corrupt/unhealthy/recovery releases apply narrow AI hold | ok |
| REG-873 | Windows Service | - | core/server/mod.rs | Corrupt active-owner startup stops associated Core before retiring broad protection | ok |
| REG-866 | Windows Service | - | core/server/mod.rs | Failed protected stop re-establishes DNS while narrow release stays separate | ok |
| REG-793 | Windows Service | - | core/server/handlers.rs | Failed update Prepare uses automatic release after safe Core/DNS proof | ok |
| REG-792 | Windows Service | - | core/server/mod.rs | SCM ordinary Stop releases non-strict broad protection after DNS/Core/owner cleanup | ok |
| REG-777 | Windows Service | - | core/windows_kill_switch.rs | Committed DIRECT expiry and commit-persist failure now fail open with AI hold | ok |
| R4FO-WIN-RELEASE-AI-DISPOSITION-CRASH | Windows selective recovery | P2 | apps/windows/service/src/core/windows_kill_switch.rs:2812 | Interrupted automatic release persists no requested AI disposition | real-unfixed issue #1077; durable recovery design and native timing remain |
| R4FO-WIN-FRESH-VERIFIED-INHERITANCE | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:1234 | Inherited verified stamp might disable current Connect deadline | false-positive #1037 masks status and mark_verified only clears after current proof |
| R4FO-WIN-CORE-RECOVERY-LOCK-ORDER | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:1414 | Core exhaustion might invert WFP and lifecycle/Core manager lock order | false-positive notification is atomic; watchdog drops WFP before lifecycle owner cleanup |
| R4FO-WIN-PENDING-DIRECT-FAIL-OPEN | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3583 | Expired Pending or Bracket DIRECT returns to Blocked after app death | false-positive deliberate exact-Blocked tests and #926 explicitly exclude these phases; #1046 records broader policy decision |
| R4FO-WIN-STRICT-UNHEALTHY-RELEASE | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3111 | Strict unhealthy watchdog could automatically release its broad barrier | duplicate deliberate preexisting #733 design; no new combined regression proven |
| R4FO-WIN-STARTUP-RETRY-WANTED-LOAD | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:577 | Initially unreadable intent can become readable wanted before retry and leave ARMED empty | duplicate #1029 documented limitation; not new combined damage |
| R4FO-WIN-SCM-DNS-CLEANUP-FAILURE | Windows Service | - | apps/windows/service/src/core/server/mod.rs:582 | DNS restore failure stops Service cleanup before broad release | false-positive DNS-before-disarm invariant intentional; #792 documents backend failure boundary |
| R4FO-WIN-MISSING-OWNER-STOP-FAILURE | Windows Service | - | apps/windows/service/src/core/server/mod.rs:650 | Corrupt owner plus Core-stop error lacks protected-DNS compensation | false-positive requires independent corrupt owner and stop failure; concrete new single-failure impact unproved |
| REG-978 | Windows Service | P2 | core/windows_kill_switch.rs:3890 | Failed-update emergency narrow release shares nonpersistent requested AI disposition | issue #1077; caller strict gates preserved; ok |
| REG-955 | Windows Service | - | core/server/mod.rs:462 | Goodbye admission reservation persists across listener restart and excludes teardown | ok |
| REG-902 | Windows Service | - | bin/service.rs:398 | Dedicated SCM checkpoint refresher covers startup plus teardown DNS budgets | ok |
| REG-1021 | Windows Service | - | core/server/mod.rs:380 | Abandoned fresh arm retirement stops owner Core outside WFP then rechecks exact epoch | ok |
| REG-812 | Windows Service | - | core/windows_kill_switch.rs:1892 | Tunnel lock recovers poisoned ARMED mutex through existing accessor | ok |
| REG-841 | Windows Service DNS | - | core/dns/mod.rs:503 | Detached registry writes own self-write guard until completion with age cap retained | ok |
| REG-769 | Windows Service | - | core/server/handlers.rs:826 | StartClash rollback, release bookkeeping and DNS snapshot housekeeping preserve fail-open boundary | ok |
| REG-753 | Windows Service | - | core/windows_kill_switch.rs:552 | Startup cleanup retry yields to successor arms; floor permits and blocks persist together | ok |
| REG-740 | Windows Service | - | core/windows_kill_switch.rs:3191 | Restored wanted Core-proof windows bounded and reconnect tombstones survive retry via #986 | ok |
| REG-738 | Windows Service selective layer | P2 | core/windows_kill_switch.rs:766 | Prefix-only secondary hold stays outside broad WFP provider but disposition is not durable | regression-fixed #1089 (OS directory); disposition issue #1077; prefix-only policy otherwise ok |
| R4FO-WIN-LEGACY-NARROW-FALLBACK | Windows App/Service | - | apps/windows/app/src-tauri/src/core/service/mod.rs:1332 | Automatic narrow release fallback retries a plain Restore when new request fails | false-positive explicitly documented compatibility and best-effort availability design in #738; no new regression |
| R4FO-WIN-FRESH-EXHAUSTION-DOUBLE-RELEASE | Windows Service | - | apps/windows/service/src/core/server/mod.rs:380 | Fresh deadline expiry and Core recovery exhaustion might clean up twice | false-positive same Service-owned deadline; lifecycle lock and epoch plus pending recheck revoke a completed predecessor |
| REG-1074 | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3687 | Committed DIRECT expiry queues epoch-fenced Core retirement before WFP/narrow fallback | ok |
| REVIEW-1087 | Windows Service selective layer | - | apps/windows/service/src/core/selective_layer.rs:143 | Set/add refresh avoids repeat-apply removal; latest revision still wins after late native completion | ok; open PR; merge shared run_command with #1089 OS binding |
| REVIEW-1089 | Windows Service selective layer | - | apps/windows/service/src/core/selective_layer.rs:132 | Immutable command validation and OS-directory executable binding accept #1087 set/add/delete templates | ok; open PR; combined constructor/safety harness 5 passed |
| R4FO-DIRECT-RETIREMENT-CANCELLATION | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:1613 | Late verification or lock could cancel committed DIRECT retirement before Core is stopped | false-positive #1074 blocks both; FRESH pending prevents proven branch clearing; fresh arm increments epoch intentionally |
| R4FO-DIRECT-RETIREMENT-LOCK-CYCLE | Windows Service | - | apps/windows/service/src/core/windows_kill_switch.rs:3739 | Core retirement could hold WFP while stop watchdog reacquires WFP | false-positive watchdog drops WFP before owner lifecycle; pending state survives stop retraction; exact epoch rechecked |
| R4FO-SELECTIVE-SET-SYSTEM-DIR-COMPOSITION | Windows Service selective layer | - | apps/windows/service/src/core/selective_layer.rs:132 | In-place set/add and OS-directory binding might reject commands or lose late Restore ordering | false-positive templates and helper compose; all six vectors validated/bound with unchanged args; keep binding in shared run_command during conflict resolution |
| REG-1048 | macOS | — | apps/macos/Tono/Services/AppState+Connect.swift:1646 | Automatic recovery intent wired but browser health sibling retains explicit disarm | regression-fixed #1061 |
| REG-760 | macOS | — | apps/macos/Tono/Services/AppState+Connect.swift:1646 | DoH automatic release bypasses new AI-preserving intent | regression-fixed #1061 |
| R4FO-MAC-BROWSER-AI-HOLD | macOS browser health | P1 | apps/macos/Tono/Services/AppState+Connect.swift:1646 | Automatic browser DNS health release removes AI hold after #760/#1048 | real-fixed #1061 |
| REG-1028 | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:644 | Failed barrier and orphan release apply AI layer after general release | regression-fixed #1061; interrupted selective-intent follow-up issue #1078 |
| REG-1043 | macOS | — | apps/macos/Tono/Services/AppState+Connect.swift:2340 | Explicit Restore retires automatic reconnect and stale TCP/status continuations | ok |
| REG-1030 | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:984 | DNS preferences contention now refuses rather than hanging IPC/watchdog | ok |
| REG-773 | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:278 | Orphan bootstrap releases after owner death; AI hold follows through #1028 | ok |
| REG-889 | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:415 | Rejected/preload failures keep live rules; unknown accepted commit releases with AI floor | ok |
| REG-761 | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:665 | Placeholder failure still flushes general block; preserves repair signal | ok |
| REG-891 | macOS | — | apps/macos/Tono/Services/AppState+Connect.swift:722 | Pending update TUN-loss guard deliberately retains update-owned barrier | ok |
| REG-840 | macOS | — | apps/macos/Tono/Core/RuntimeCleanup.swift:259 | No-answer status reads reach repair without changing mutation grant | ok |
| REG-756 | macOS | — | apps/macos/Tono/Core/RuntimeCleanup.swift:432 | Repaired helper sweeps protected DNS despite absent snapshot | ok |
| REG-885 | macOS | — | apps/macos/Tono/Services/AppState+Connect.swift:1427 | Healthy probe clears only monitor-owned error message | ok |
| R4FO-MAC-QUIT-HOLD | macOS | P1 | apps/macos/Tono/App/AppDelegate.swift:347 | Quit uses explicit disarm and removes AI hold | duplicate decision #1031 and issue #1052 |
| R4FO-MAC-PREFS-RELEASE | macOS helper | P2 | tooling/scripts/core-helper/SocketServer.swift:253 | Nonblocking DNS contention may delay DNS restore after Core stop | false-positive watchdog retries snapshot; existing native-failure limit |
| R4FO-MAC-UPD-BROWSER-HOLD | macOS update | P2 | apps/macos/Tono/Services/AppState+Connect.swift:722 | Pending update dispatch ignores automatic AI-hold intent on browser failure | concern: independent pending update plus DNS conflict; deliberate update ownership needs separate review |
| R4FO-MAC-PRELOAD-STATE | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:342 | Rejected PF reload leaves new saved intent while old rules remain live | false-positive App rollback or Core-down watchdog repairs; no single-failure leaked or permanent outage proven |
| REG-720 | macOS | — | apps/macos/Tono/Services/AppState+Connect.swift:2258 | Exhausted release reaches AI-preserving helper via #1048; retry ownership fenced by #1043 | ok |
| REG-744 | macOS core policy | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:157 | New fake-IP range matches ProtectedDNSProbe; both DoH legs use protected exit | ok |
| REG-749 | macOS core policy | — | apps/macos/Tono/Services/AppState+Connect.swift:584 | HY2 keepalive and failure annotations leave fail-open dispatch intact | ok |
| REG-1008 | macOS termination | — | apps/macos/Tono/App/AppDelegate.swift:315 | Credential draining runs after network cleanup under existing termination deadline | ok |
| R4FO-MAC-GATE-LOCK-ORDER | macOS helper | P1 | tooling/scripts/core-helper/HelperPower.swift:18 | Potential transitionGate and KillSwitchManager lock-order inversion | false-positive IPC mutators serialized; power callback releases gate before acquiring firewall lock |
| R4FO-MAC-BOOT-SELECTIVE | macOS helper | P2 | tooling/scripts/core-helper/SocketServer.swift:209 | Reboot after selective release may lose volatile Claude route though resolver survives | false-positive documented cache/IP and best-effort layer limits; no newly introduced route persistence guarantee |
| R4FO-MAC-SLEEP-SELECTIVE | macOS helper | P1 | tooling/scripts/core-helper/KillSwitchManager.swift:557 | Failed sleep barrier may leave general release without AI hold | duplicate fixed #1028; rejection/unissued load preserves prior live rules by #889 |
| R4FO-MAC-CORE-STOP-ROUTES | macOS helper | P2 | tooling/scripts/core-helper/SocketServer.swift:318 | Failed core stop during orphan bootstrap release may retain TUN/DNS listener | false-positive requires independent App death and native core-stop failure; existing best-effort limit |
| REG-803 | policy docs | — | docs/decisions/036-2026-09-30-crash-hang-releases-then-ai-layer.md:3 | Decision split preserves owner availability-first AI layer and explicit Restore semantics | ok |
| R4FO-MAC-UNARMED-CLEANUP-AI-HOLD | macOS connect failure | P1 | apps/macos/Tono/Services/AppState+Connect.swift:975 | Unarmed automatic cleanup removes the helper AI hold after native arm failure | real-fixed #1061 |
| R4FO-MAC-SELECTIVE-CRASH-INTENT | macOS selective recovery | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:577 | Helper death after general intent deletion permanently forgets AI application | real-unfixed issue #1078; separate durable contract and native test required |
| R4FO-MAC-SUPPLEMENTAL-HOLD | macOS | P2 design | apps/macos/Tono/Services/AppState+Connect.swift:2532 | Supplemental DNS conflict deliberately stops Core and holds general traffic until watchdog release | duplicate R3CONN-DEC01 open issue #1057; deliberate policy needs product decision |
| R4FO-MAC-DNS-LIMIT-HOLD | macOS | P2 | apps/macos/Tono/Services/AppState+Connect.swift:2501 | Repeated broken-DNS audit threshold retains PF without immediate general release | false-positive prior broken audit release resets counter; no plausible normal-path third audit proved |
| R4FO-POLICY-DECISION-TEST | policy docs | P3 | tooling/scripts/tests/records.test.mjs:82 | Adding later decisions might invalidate the split-records newest-heading test | false-positive current main derives highest-numbered heading; all3 node records tests pass |
| REG-797 | policy | — | services/control-plane/src/traffic-policy.ts:331 | Reviewed merged suffix guard across both clients and Worker; 80 home suffixes and 39 guards agree | ok |
| REG-1042 | Windows update | P1 | apps/windows/service/src/bin/install_service/update_executor.rs:433 | Known RolledBack task-registration refusal returns before common rollback network release | concern: verified sibling rollback release duplicates #1075 |
| REG-858 | Windows update | — | apps/windows/service/src/bin/install_service/update_executor.rs:377 | Recorded successor resume and restart-failure cleanup compose with AI variant and rollback release | ok |
| REG-1017 | Windows update | — | apps/windows/service/src/bin/install_service/update_executor.rs:807 | Committed cleanup propagates artifact removal failure before retiring ONSTART recovery task | ok |
| REG-776 | Windows update | — | apps/windows/service/src/bin/install_service/update_executor.rs:265 | Manual gates abandon timed-out blocking runtime; recovery schtasks derives OS system directory | ok |
| REG-911 | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:393 | Completed-target recovery early return precedes publication-clock fallback added to later unreachable TargetVerified arm | issue #1055 (existing missing publication-clock recovery finding) |
| R4FO-UPD-TASK-ROLLBACK-HOLD | Windows native update | P1 | apps/windows/service/src/bin/install_service/update_executor.rs:433 | Task Scheduler refusal returns before proven rollback releases ordinary traffic | duplicate of #1075 (opened during verification; local patch dropped) |
| R4FO-POLICY-GUARD-PARITY | policy | — | apps/windows/crates/tono-core/src/policy.rs:301 | Suspected mismatched AI domains or narrow prefixes across platforms | false-positive exact 80 home/39 guard/22 hold sets match; narrow exclusions intentional docs and #1046 |
| R4FO-MAC-SIGNED-APP-AI-DIRECT | macOS policy | P1 | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:178 | No-home path permits AI host/IP from signed Chinese app before terminal exit rule | duplicate of open #867 |
| R4FO-WIN-SINGBOX-AI-DIRECT | Windows policy | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:274 | No-home sing-box path lacks #871 assistant shield before signed-app DIRECT rule | false-positive as current shipped path: Windows product remains Mihomo; blocked #203 migration owns latent path |
| R4FO-UPD-LIVE-SUCCESSOR-SERVICE | Windows update | — | apps/windows/service/src/bin/install_service/update_executor.rs:377 | Recovery resumes live successor without restarting Service | false-positive new P1 claim: recovery launched by live Service or reboot ONSTART; pre-restart abrupt death delay already #858 documented |
| REG-871 | Windows policy | — | apps/windows/crates/tono-core/src/config.rs:1137 | Assistant suffix and Anthropic rows precede current Mihomo signed-app DIRECT and readback checks match | ok |
| R4FO-WIN-UPDATE-HOLD-RESTART | Windows update | — | apps/windows/service/src/core/windows_kill_switch.rs:3305 | Suspected normal Service restart removes failed-update AI hold | false-positive wanted:false and missing-intent recovery preserve separate firewall/NRPT hold |
| R4FO-UPD-RECOVERY-CLOCK | Windows update | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:393 | Complete-target recovery early return skips missing publication-clock fallback added by #911 | duplicate of issue #1055 R3REGW-RECOVERY-PUBLICATION-FLOOR |
| R4FO-UPD-SCHTASKS-HANG | Windows update | P1? | apps/windows/service/src/core/update.rs:1006 | Synchronous recovery-task registration has no deadline while prepared Core is stopped and Store/repair held | concern: native Task Scheduler stall not reproduced; source timeout omission sent to root |
| R4FO-UPD-PREREQUISITE-REFUSAL | Windows update | P1? | apps/windows/service/src/bin/install_service/update_executor.rs:442 | SCM open/suppress/stop failures return before common rollback release | concern: no RolledBack proof and native failure not reproduced; avoid broadening uncertain recovery in scheduler patch |
| R4FO-WIN-SELECTIVE-SYSTEM-DIR | Windows selective recovery | P2 | apps/windows/service/src/core/selective_layer.rs:306 | Fixed C-drive executable omits AI prefix rules on supported non-C Windows installations | real-fixed #1089; same finding as issue #1085 netsh row (published during fix) |
| REG-1045 | Windows app restore | — | apps/windows/app/src-tauri/src/tono/commands/restore.rs:120 | Restore snapshots account generation before await and preserves a replacement interactive sign-in | ok |
| REG-1010 | Windows app failure | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:55 | Transferred failure writer retains apply_narrow and joins the actual release result | ok |
| REG-1003 | Windows app health | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Ordinary health cleanup selects AI-preserving release; strict/policy rebuild stay protected | ok; stalled DIRECT-writer boundary already issue #1051 |
| REG-980 | Windows app quit | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:363 | Committed exit flushes current credentials after generation-guarded release, before goodbye | ok |
| REG-961 | Windows update | — | apps/windows/service/src/bin/install_service/update_executor.rs:712 | Executor launch refusal rolls back prepared network; strict and narrow selection retained | ok |
| REG-945 | Windows app monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:476 | Identity and delay results retain measured node plus generation before applying new display fields | ok; no network mutation in the reviewed change |
| REG-942 | Windows app monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:421 | Late status probe cannot replace newer FSM generation or release reading | ok |
| REG-878 | Windows app monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:957 | Deferred network events remain queued through debounce and are cleared on recovery cancellation | ok |
| REG-784 | Windows app quit | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:292 | Quit reads owned Service protection before unprotected fast path; cancelled Quit resumes catalog sync | ok |
| REG-779 | Windows app update | — | apps/windows/app/src-tauri/src/tono/commands/update.rs:220 | Failed Prepare folds only retired generation and uses update-aware narrow release for proven running Core | ok; absent Core/unknown snapshot protected boundary remains deliberate |
| REG-772 | Windows app update | — | apps/windows/app/src-tauri/src/tono/commands/update.rs:304 | Only first certain Adopt authorizes automatic recovery Connect; repeated adoption stays Held | ok |
| REG-757 | Windows app monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1050 | Changed signed-app inputs trigger protected policy rebuild rather than health fail-open | ok |
| REG-735 | Windows app restore | — | apps/windows/app/src-tauri/src/tono/commands/restore.rs:613 | Account display fields propagate restore payload without changing release or AI policy | ok; scope review excludes visual rendering |
| REG-715 | Windows app health | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Give-up shared release now composes with #1003 narrow AI disposition and #1010 writer transfer | ok; existing stalled writer issue #1051 separate |
| REG-1061 | macOS automatic cleanup | — | apps/macos/Tono/Services/AppState+Connect.swift:975 | Browser health and unarmed-connect cleanup share failure release intent and preserve AI floor | ok; own PR merged with all relevant native macOS CI checks green |
| R4FO-WIN-STALE-HEALTH-RELEASE | Windows app monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1381 | Stale health continuation could release a successor after connection generation changes | false-positive monitor/pin-refresh tasks are aborted on invalidation and post-probe generation/connected guards exclude successors |
| R4FO-WIN-POLICY-REBUILD-RELEASE | Windows app policy | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1395 | Signed-app policy rebuild might take the ordinary automatic health release and loosen AI routing | false-positive task-local POLICY_REBUILD suppresses health release and invokes protected reconnect |
| R4FO-WIN-RESTORE-AUTH-HOLD | Windows app restore | — | apps/windows/app/src-tauri/src/tono/commands/restore.rs:438 | No-token or failed account restore might skip normal internet release | false-positive known protection is released on missing token; unknown protection and credential/401 refusals deliberately preserve existing evidence and expose Restore |
| R4FO-WIN-HEALTH-DIRECT-WRITER | Windows app health | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1408 | Stalled DIRECT reload holds a reader ahead of automatic release writer | duplicate open issue #1051; not a new combined regression |
