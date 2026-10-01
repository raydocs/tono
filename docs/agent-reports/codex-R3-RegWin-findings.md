# R3-RegWin: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1037 | hunt/sol-r3regw-fresh-arm-proof | needs-hardware | yes | fix(windows): require fresh-arm proof in verification readback |
| 1040 | hunt/sol-r3regw-update-release-ai | needs-hardware | yes | fix(windows): keep AI blocking in pending-update failure cleanup |
| 1044 | hunt/sol-r3regw-direct-single-ai-hold | needs-hardware | yes | fix(windows): avoid reopening the AI hold on DIRECT expiry |

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
| R3REGW-FRESH-ARM-READBACK | Windows Service proof | P1 | apps/windows/service/src/core/windows_kill_switch.rs:4074 | Inherited verification acknowledges an undelivered MarkVerified and leaves fresh deadline active | real-fixed #1037 |
| REG-1021 | Windows Service proof | P1 | apps/windows/service/src/core/windows_kill_switch.rs:4045 | Fresh deadline combines with inherited verified readback to retire healthy reconnect | regression-fixed #1037 |
| REG-1010 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection.rs:681 | guard transfer uses narrow release | ok |
| REG-1005 | Windows app | — | apps/windows/service/src/core/windows_kill_switch.rs:3518 | unverified retirement narrow/strict branches retained | ok |
| REG-1003 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1309 | automatic health cleanup preserves AI hold | ok |
| REG-945 | Windows app | — | apps/windows/app/src-tauri/src/tono/commands/catalog.rs:280 | hot-switch probe results scoped to node owner | ok |
| REG-942 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:136 | stale status publication generation rejected | ok |
| REG-917 | Windows app | — | apps/windows/service/src/core/runtime_generation/owned_config.rs:97 | runtime TUN proof aligns owned producer | ok |
| REG-900 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection.rs:308 | only inactive DIRECT metadata resets | ok |
| REG-898 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:796 | controller wait cancellation preserves Service mutation owner | ok |
| REG-884 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/transaction.rs:34 | Core/browser-DNS time included in budget | ok |
| REG-879 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/platform.rs:213 | down hardware NIC filtered from optional DIRECT bind | ok |
| REG-878 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection_health.rs:161 | debounce defers baseline while preserving later invalidation | ok |
| REG-874 | Windows app | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:621 | previous-account failover state resets on finalization | ok |
| REG-871 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:973 | assistant shield producer and consumer agree | ok |
| REG-797 | Windows app | — | apps/windows/crates/tono-core/src/policy.rs:301 | DIRECT assistant suffix rejection retained | ok |
| REG-787 | Windows app | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:197 | routing rebuild and lifecycle cleanup compose; known Connecting limitation | ok |
| REG-786 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:205 | equal routing revisions renew; empty graph skips reload | ok |
| REG-784 | Windows app | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:40 | owned pre-discovery protection release and cancelled sync revival | ok |
| REG-772 | Windows app | — | apps/windows/app/src-tauri/src/tono/commands/update.rs:312 | only first certain update adoption permits reconnect | ok |
| REG-771 | Windows app | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:518 | empty ASCII fold no longer equates Unicode names | ok |
| REG-1025 | Windows DNS/update | — | apps/windows/service/src/core/update.rs:355 | prior committed scratch cleaned only after member proof | ok |
| REG-1017 | Windows DNS/update | — | apps/windows/service/src/bin/install_service/update_executor.rs:737 | cleanup failure retains recovery task | ok |
| REG-1007 | Windows DNS/update | — | apps/windows/service/src/core/update.rs:325 | post-stop failed Prepare requests AI hold | ok |
| REG-989 | Windows DNS/update | — | apps/windows/service/src/core/dns/mod.rs:550 | restore-only whitespace parser preserves saved registry bytes | ok |
| REG-988 | Windows DNS/update | — | apps/windows/service/src/core/selective_layer.rs:45 | native timeouts retain ordered worker ownership | ok |
| REG-987 | Windows DNS/update | — | apps/windows/service/src/core/dns/engine.rs:528 | new adapter DoH originals durable before mutation | ok |
| REG-985 | Windows DNS/update | — | apps/windows/service/src/core/dns/engine.rs:412 | locked restored captures retained with retirement marker | ok |
| REG-978 | Windows DNS/update | — | apps/windows/service/src/bin/install_service/update_executor.rs:578 | restart recovery preserves strict and narrow guards | ok |
| REG-961 | Windows DNS/update | — | apps/windows/service/src/core/update.rs:595 | executor never spawned releases non-strict with AI hold | ok |
| REG-923 | Windows DNS/update | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:192 | quarantined helper settles UI without opening operation admission | ok |
| REG-925 | Windows DNS/update | — | apps/windows/app/src-tauri/src/core/sysopt.rs:151 | proxy clear waiter registers wakeup then runs own clear | ok |
| REG-868 | Windows DNS/update | — | apps/windows/service/src/core/dns/engine.rs:1047 | IPv4 CIM84 still reaches IPv6 | ok |
| REG-858 | Windows DNS/update | — | apps/windows/service/src/core/update/security.rs:702 | exact successor resumes once; narrow/strict fallback retained | ok |
| REG-844 | Windows DNS/update | — | apps/windows/service/src/core/dns/mod.rs:3214 | update proof cannot heal DNS behind wanted WFP | ok |
| REG-841 | Windows DNS/update | — | apps/windows/service/src/core/dns/mod.rs:501 | blocking writer retains DNS self-write guard | ok |
| REG-828 | Windows DNS/update | — | apps/windows/app/src-tauri/src/tono/windows_dns.rs:52 | callback owns completion through notify | ok |
| REG-824 | Windows DNS/update | — | apps/windows/service/src/core/update.rs:1110 | task operations use OS system directory | ok |
| REG-801 | Windows DNS/update | — | apps/windows/service/src/bin/install_service.rs:1499 | verified candidates survive rollback; Service restaged on retry | ok |
| REG-776 | Windows DNS/update | — | apps/windows/service/src/bin/shared/mod.rs:38 | abandoned runtime drop avoids native-call hang | ok |
| REG-769 | Windows DNS/update | — | apps/windows/service/src/core/dns/mod.rs:2852 | delete-only restore path safe; earlier rewrite gap duplicate #982 | ok |
| REG-1024 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:2785 | pending crash retry cancelled after release | ok |
| REG-1022 | Windows Service | — | apps/windows/service/src/core/owner.rs:111 | takeover verifies same owned process handle | ok |
| REG-1014 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:2991 | automatic stop retains armed non-strict AI hold | ok |
| REG-1012 | Windows Service | — | apps/windows/service/src/core/manager.rs:1147 | timeout termination pins Core creation identity | ok |
| REG-1004 | Windows Service | — | apps/windows/service/src/bin/shared/mod.rs:205 | SCM/image/creation checks precede escalation | ok |
| REG-999 | Windows Service | — | apps/windows/service/src/core/manager.rs:854 | confirmed dead Core PID retired before cleanup awaits | ok |
| REG-994 | Windows Service | — | apps/windows/service/src/core/process.rs:290 | orphan termination checks path and creation identity | ok |
| REG-986 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:555 | unwanted-intent retries preserve reconnect evidence | ok |
| REG-983 | Windows Service | — | apps/windows/app/src-tauri/src/core/service/mod.rs:1339 | selective release retry preserves narrow intent | ok |
| REG-976 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:1301 | AI hold removed only after exact WFP install succeeds | ok |
| REG-974 | Windows Service | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3121 | Committed DIRECT expiry deletes its newly-installed AI hold through a redundant second apply | regression-fixed #1044 |
| REG-955 | Windows Service | — | apps/windows/service/src/core/server/handlers.rs:1041 | shutdown reserved under lifecycle ownership | ok |
| REG-933 | Windows Service | — | apps/windows/service/src/client/mod.rs:172 | SCM native-thread slots survive waiter timeout | ok |
| REG-929 | Windows Service | — | apps/windows/app/src-tauri/src/core/service/mod.rs:281 | log read has no owner-recovery mutation | ok |
| REG-912 | Windows Service | — | apps/windows/app/src-tauri/src/core/service/mod.rs:554 | bounded SCM reads refuse late concurrent repair | ok |
| REG-911 | Windows Service | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:376 | Complete-publication recovery returns before missing publication floor is recorded | concern: real-unfixed P2; interrupted publication plus prepublication mapped peer; native exposure unverified |
| REG-902 | Windows Service | — | apps/windows/service/src/bin/service.rs:422 | SCM stop hint refresher exits and joins bounded | ok |
| REG-873 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:362 | record absence still stops supervised Core | ok |
| REG-866 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:339 | unconfirmed stop reinstalls protected DNS | ok |
| REG-812 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:1992 | poisoned ARMED lock uses recovery accessor | ok |
| REG-792 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:561 | stop release strict/narrow and DNS guards retained | ok |
| REG-775 | Windows Service | — | apps/windows/service/src/core/runtime.rs:79 | corrupt record quarantine follows orphan proof | ok |
| REG-779 | Windows update cleanup | P1 | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:275 | Automatic failed-Prepare update Disconnect drops narrow intent | regression-fixed #1040 |
| REG-793 | Windows update cleanup | P1 | apps/windows/service/src/core/update.rs:670 | Early staging error bypasses post-stop AI cleanup and App pending route uses plain release | regression-fixed #1040 |
| REG-777 | Windows DIRECT expiry | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3664 | Committed DIRECT expiry deletes its newly-installed AI hold through a redundant second apply | regression-fixed #1044 |
| R3REGW-DIRECT-DOUBLE-HOLD | Windows DIRECT expiry | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3664 | Committed DIRECT expiry deletes its newly-installed AI hold through a redundant second apply | real-fixed #1044 |
| REG-951 | Windows Activity | — | apps/windows/app/src/pages/tono/activity-model.ts:129 | Object.hasOwn admits only declared string process families | ok |
| REG-932 | Windows account UI | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:54 | account/device cache uses current process and sign-in generation; nil scope disables fetch | ok |
| REG-984 | Windows singleton | — | apps/windows/app/src-tauri/src/utils/server.rs:100 | authenticated loopback notification bypasses inherited external proxies | ok |
| REG-820 | Windows status subscription | — | apps/windows/app/src/services/tono.ts:882 | live listener reused; pending registration/last-owner teardown retained | ok |
| REG-857 | Windows parser tests | — | apps/windows/crates/tono-core/src/node.rs:593 | bounded test additions only; no production parser behavior changes | ok |
| R3REGW-UPDATE-DISCONNECT-AI-HOLD | Windows update cleanup | P1 | apps/windows/service/src/core/update.rs:670 | Automatic pending-update release loses AI-hold disposition | real-fixed #1040 |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Windows update recovery | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:376 | Complete-publication recovery bypasses publication-floor fallback | real-unfixed: incomplete #911; narrow interruption plus old mapped peer; no native reproduction; lower priority tonight |
| R3REGW-FP-01 | Windows startup retry | — | apps/windows/service/src/core/windows_kill_switch.rs:555 | Startup release retry erases AI hold | false-positive: wanted:false retry preserves existing disposition; corrupt/crash startup applies AI hold directly |
| R3REGW-FP-02 | Windows owner takeover | — | apps/windows/service/src/core/owner.rs:111 | Owner guard Drop deletes successor metadata | false-positive: metadata is deleted before lock release; successor ownership remains excluded |
| R3REGW-FP-03 | Windows Core cleanup | — | apps/windows/service/src/core/manager.rs:1147 | Core stop loses process identity before timeout escalation | false-positive: identity is captured while Child is owned; ordinary stop retains it |
| R3REGW-FP-04 | Windows SCM stop | — | apps/windows/service/src/bin/service.rs:553 | Checkpoint refresh worker hangs shutdown | false-positive: teardown is bounded and refresher joins with a one-second bound |
| R3REGW-FP-05 | Windows goodbye | — | apps/windows/service/src/core/server/handlers.rs:1041 | Shutdown reservation blocks a new Service process | false-positive: reservation is process-local state and resets on a new process |
| R3REGW-FP-06 | Windows SCM repair | — | apps/windows/app/src-tauri/src/core/service/mod.rs:554 | Timed-out SCM read enters concurrent privileged repair | false-positive: timeout returns before repair admission |
| R3REGW-FP-07 | Windows orphan cleanup | — | apps/windows/service/src/core/process.rs:290 | Path recheck kills recycled PID | false-positive: path and captured creation time are verified on the same termination handle |
| R3REGW-FP-08 | Windows update executor | — | apps/windows/service/src/bin/install_service/update_executor.rs:277 | Executor starts publication before its identity is durable | false-positive: open_waiting waits for store lock held by parent while identity is persisted |
| R3REGW-FP-09 | Windows DNS retirement | — | apps/windows/service/src/core/dns/engine.rs:528 | Crash between recapture and marker retirement loses original DoH | false-positive: originals are durable and marker cleared before registry suppression |
| R3REGW-FP-10 | Windows selective worker | — | apps/windows/service/src/core/selective_layer.rs:84 | Worker state mutex spans native apply commands | false-positive: temporary condition guard drops before apply; newer revision is reconciled |
| R3REGW-FP-11 | Windows update DNS | — | apps/windows/service/src/core/dns/mod.rs:3214 | Update observation heals DNS during concurrent ordinary arm | false-positive: update holds owner lifecycle lock; ordinary arm serializes |
| R3REGW-FP-12 | Windows installer retry | — | apps/windows/service/src/bin/install_service.rs:1499 | Deleting Service next candidate prevents installer retry | false-positive: each retry stages Service again and revalidates retained candidates |
| R3REGW-FP-13 | Windows helper quarantine | — | apps/windows/app/src-tauri/src/core/runstate/mod.rs:204 | Quarantined helper state admits another privileged operation | false-positive: op_in_flight remains occupied and begin_operation refuses uncertain slot |
| R3REGW-FP-14 | Windows DNS callback | — | apps/windows/app/src-tauri/src/tono/windows_dns.rs:52 | Awakened waiter frees callback before notification finishes | false-positive: callback owns separate Arc through response consumption and notification |
| R3REGW-FP-15 | Windows startup rollback | — | apps/windows/service/src/core/server/handlers.rs:765 | StartClash rollback newly releases strict protection | false-positive: rollback covers new bootstrap arm with existing strict=false construction |
| R3REGW-FP-16 | Windows catalog rebuild | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:282 | Catalog routing rebuild deadlocks its policy writer | false-positive: optional DIRECT reader acquisition is spawned; connect returns and writer drops |
| R3REGW-FP-17 | Windows DIRECT reset | — | apps/windows/app/src-tauri/src/tono/connection.rs:308 | Clearing signed-app paths widens active policy | false-positive: reset clears inactive metadata before overlay exists; no firewall widening |
| R3REGW-FP-18 | Windows node probes | — | apps/windows/app/src-tauri/src/tono/state.rs:416 | Same-node ABA probe race is introduced by tonight fix | false-positive: name-based display race predates #945; no network-policy effect proved |
| R3REGW-DNS-SNAPSHOT-REWRITE | Windows DNS restore | P1 | apps/windows/service/src/core/dns/mod.rs:2771 | Locked snapshot refresh can fail before deletion-tolerant restore proof | duplicate of #982; no competing fix |
| R3REGW-CATALOG-CONNECTING | Windows catalog routing | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:346 | Residential routing rebuild requires Connected while connect uses captured routing | duplicate of known #787 limitation; deliberately deferred, no change |
| REG-1029 | Windows startup retry | — | apps/windows/service/src/core/windows_kill_switch.rs:555 | Ownerless startup retry preserves AI hold, strict intent, successor and Restore disposition | ok |
| REG-1032 | Windows Core exhaustion | — | apps/windows/service/src/core/manager.rs:1109 | Epoch-fenced exhaustion retirement preserves AI hold and strict protection | ok |
| REG-1037 | Windows verification | — | apps/windows/service/src/core/windows_kill_switch.rs:4074 | Fresh-arm readback composes with Core exhaustion and update recovery | ok |
| R3REGW-FP-19 | Windows startup retry | — | apps/windows/service/src/core/windows_kill_switch.rs:555 | Stale startup retry removes successor WFP protection | false-positive: ARMED and wanted-intent rechecked under WFP writer lock |
| R3REGW-FP-20 | Windows startup retry | — | apps/windows/service/src/core/windows_kill_switch.rs:555 | Startup retry overrides explicit Restore by reapplying AI hold | false-positive: wanted:false path preserves disposition; serialized layer supersedes late worker |
| R3REGW-FP-21 | Windows Core exhaustion | — | apps/windows/service/src/core/windows_kill_switch.rs:3711 | Exhaustion notification deadlocks Core stop joining watcher | false-positive: notifying watcher takes only WFP; retirement drops WFP before lifecycle and join |
| REG-1036 | Windows catalog release | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:62 | Catalog removal narrow release composes with lifecycle, strict and update fences | ok |
| REG-1038 | Windows Quit | — | apps/windows/app/src-tauri/src/feat/window.rs:546 | Only optional idle Service shutdown is bounded after required quit cleanup | ok |
| REG-1040 | Windows update cleanup | — | apps/windows/service/src/core/update.rs:646 | Narrow pending-update operation composes with strict, owner and release fences | ok |
| REG-1044 | Windows DIRECT expiry | — | apps/windows/service/src/core/windows_kill_switch.rs:3661 | Merged expiry invokes the shared AI hold once; combined WFP111pass | ok |
| REG-1045 | Windows startup auth | — | apps/windows/app/src-tauri/src/tono/commands/restore.rs:110 | Startup reserves initial auth generation before adoption and respects interactive ownership | ok |
| REG-754 | Windows DNS restore | — | apps/windows/service/src/core/dns/mod.rs:1052 | GUID case comparison preserves exact DNS values and live proof | ok |
| REG-741 | Windows runtime DNS | — | apps/windows/crates/tono-core/src/config.rs:956 | Exit DNS additions retain both DoH resolvers and match Service whitelist | ok |
| REG-749 | Windows HY2 keepalive | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:396 | Keepalive stamps admitted HY2 outbound after certificate gate | ok |
| REG-1042 | Windows update rollback | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:622 | Failed publication plus failed restart repeats a successfully-installed AI hold | concern: real-unfixed; source-proven, native-unverified; two failures; cutoff passed |
| R3REGW-ROLLBACK-DOUBLE-HOLD | Windows update rollback | P2 | apps/windows/service/src/bin/install_service/update_executor.rs:622 | Second emergency release removes AI hold after rollback already installed it | real-unfixed: two independent failures; native gap unverified; no new fixes after22:45 |
| REG-714 | Windows background reconnect | P1 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:155 | Failed admitted connect resets probe schedule and immediately retries a TCP-open exit | concern: real-unfixed P1; exact production loop harness proves no post-failure backoff; cutoff passed |
| R3REGW-UNARMED-CONNECT-BACKOFF | Windows background reconnect | P1 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:155 | Persistent TLS/data-plane failure with reachable TCP repeatedly arms and releases instead of backing off | real-unfixed: production run plus Schedule harness6failures in119.687us; no new fixes after22:45 |
| R3REGW-FP-22 | Windows DNS GUID | — | apps/windows/service/src/core/dns/mod.rs:1058 | GUID case folding accepts changed resolver values | false-positive: four resolver values remain exact and live proof is still required |
| R3REGW-FP-23 | Windows DNS schema | — | apps/windows/service/src/core/runtime_generation/owned_config.rs:43 | Exit DNS additions fail Service runtime whitelist | false-positive: whitelist includes all generated keys |
| R3REGW-FP-24 | Windows HY2 admission | — | apps/windows/crates/tono-core/src/sing_box/runtime.rs:202 | Keepalive skips certificate pin gate or introduces another outbound | false-positive: certificate admission precedes mutation; only existing HY2 objects changed |
| REG-757 | Windows App | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:400 | Signed-path changes prohibit in-place recovery; health cleanup retains AI hold | ok |
| REG-715 | Windows health cleanup | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Health give-up releases narrow while policy-rebuild and strict exclusions remain | ok |
| REG-722 | Windows stage wire | — | apps/windows/crates/tono-core/src/connect_timing.rs:23 | Shared stage mapping retains all nine Windows strings and timing budgets | ok |
| REG-735 | Windows account display | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:226 | Plan/expiry/usage additions remain display-only; scoped account fetch preserved | ok |
| REG-731 | Windows session display | — | apps/windows/app/src/pages/tono/dashboard.tsx:717 | Session total consumes generation-bound live feed; no mutation path | ok |
| REG-726 | Windows connection copy | — | apps/windows/app/src/pages/tono/dashboard.tsx:695 | Connected subtitle remains display-only and preserves skipped DIRECT detail | ok |
| REG-723 | Windows onboarding hint | — | apps/windows/app/src/pages/tono/dashboard.tsx:852 | Checklist removal retains measured DNS hint without altering cleanup actions | ok |
| REG-717 | Windows intro | — | apps/windows/app/src/pages/tono/intro.tsx:20 | Single-screen intro preserves persisted seen marker and login navigation | ok |
| REG-673 | Windows dependencies | — | apps/windows/app/package.json:61 | Manifest and lock update only; applicable frontend/App CI passed | ok: dependency-consumer diff review; package internals not exhausted |
| REG-670 | Windows plugin build dependencies | — | apps/windows/crates/tono-plugin-core/package.json:29 | Rollup patch update changes build tooling only; lockfile and CI retained | ok: dependency-consumer diff review; package internals not exhausted |
| R3REGW-FP-25 | Windows background reconnect | — | apps/windows/app/src-tauri/src/tono/connection.rs:331 | Probe admission aborts its own registered background task | false-positive: generation retirement omits cancellation; task-local guard prevents self replacement |
| REG-753 | Windows startup WFP | — | apps/windows/service/src/core/windows_kill_switch.rs:555 | Startup retry is fenced; persistent loopback, DHCP and NDP permit floor retained | ok |
| REG-740 | Windows restored barrier | — | apps/windows/service/src/core/windows_kill_switch.rs:2965 | Unproven-Core recovery retains AI hold; strict and explicit release exclusions remain | ok |
| REG-738 | Windows selective AI hold | P2 | apps/windows/service/src/core/selective_fail_open.rs:106 | Hardcoded C-drive netsh loses Claude IP rules on alternate system drives | concern: real-unfixed; source-proven alternate-drive omission; native untested; cutoff passed |
| R3REGW-SELECTIVE-NETSH-PATH | Windows selective AI hold | P2 | apps/windows/service/src/core/selective_fail_open.rs:106 | Automatic AI prefix hold invokes nonexistent C-drive netsh on alternate Windows system root | real-unfixed: valid uncommon installation; no system-directory fallback; native untested; cutoff passed |
| REG-718 | Windows protected policy reconnect | P2 | apps/windows/app/src-tauri/src/tono/connection.rs:440 | Unconditional App TCP proof runs behind retained blocked WFP on policy rebuild | concern: real-unfixed; source-proven, native-unverified; healthy VLESS reconnect fails after cache expiry; cutoff passed |
| R3REGW-PROTECTED-TCP-PROOF | Windows protected policy reconnect | P2 | apps/windows/app/src-tauri/src/tono/connection.rs:440 | Retained protected policy rebuild blocks its own App TCP preflight before Core restart | real-unfixed: Core-only physical endpoint permit; later failure restores normal internet; native unverified; cutoff passed |
| R3REGW-FP-26 | Windows health preflight | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Ordinary health-loss reconnect performs TCP proof behind retained WFP | false-positive: ordinary health loss releases before spawning unarmed probe; policy rebuild separately affected |
| REG-739 | Windows AI tally | P2/P3 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48 | Unscoped account cache shows prior local tally; flow receipt Map retains historical IDs | concern: real-unfixed; actual SWR component and accumulator tests failed; cutoff passed |
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | Windows AI tally | P2 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48 | Cached prior account loads and displays its local tally after replacement sign-in | real-unfixed: real SWR/component test fails under pending replacement local IPC; transient UI data exposure; cutoff passed |
| R3REGW-AI-TALLY-SEEN-GROWTH | Windows AI tally | P3 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:28 | Module deduplication retains every historical flow ID until controller generation changes | real-unfixed: actual accumulator retains6000 completed IDs after empty frame; OOM/hang not demonstrated; cutoff passed |
