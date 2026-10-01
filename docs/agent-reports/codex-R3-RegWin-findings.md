# R3-RegWin: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:24 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1037 | hunt/sol-r3regw-fresh-arm-proof | needs-hardware | yes | fix(windows): require fresh-arm proof in verification readback |
| 1040 | hunt/sol-r3regw-update-release-ai | needs-hardware | yes | fix(windows): keep AI blocking in pending-update failure cleanup |

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
| R3REGW-FRESH-ARM-READBACK | Windows Service proof | P1 | apps/windows/service/src/core/windows_kill_switch.rs:4053 | Inherited verification acknowledges an undelivered MarkVerified and leaves fresh deadline active | real-fixed #1037 |
| REG-1021 | Windows Service proof | P1 | apps/windows/service/src/core/windows_kill_switch.rs:4045 | Fresh deadline combines with inherited verified readback to retire healthy reconnect | regression-fixed #1037 |
| REG-1010 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection.rs:681 | guard transfer uses narrow release | ok |
| REG-1005 | Windows app | — | apps/windows/service/src/core/windows_kill_switch.rs:3518 | unverified retirement narrow/strict branches retained | ok |
| REG-1003 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1309 | automatic health cleanup preserves AI hold | ok |
| REG-945 | Windows app | — | apps/windows/app/src-tauri/src/tono/commands/catalog.rs:280 | hot-switch probe results scoped to node owner | ok |
| REG-942 | Windows app | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:136 | stale status publication generation rejected | ok |
| REG-917 | Windows app | — | apps/windows/app/src-tauri/src/tono/runtime_generation/owned_config.rs:97 | runtime TUN proof aligns owned producer | ok |
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
| REG-974 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:3121 | automatic WFP recovery preserves AI hold; DIRECT double apply concern separately | ok |
| REG-955 | Windows Service | — | apps/windows/service/src/core/server/handlers.rs:1041 | shutdown reserved under lifecycle ownership | ok |
| REG-933 | Windows Service | — | apps/windows/service/src/client/mod.rs:172 | SCM native-thread slots survive waiter timeout | ok |
| REG-929 | Windows Service | — | apps/windows/app/src-tauri/src/core/service/mod.rs:281 | log read has no owner-recovery mutation | ok |
| REG-912 | Windows Service | — | apps/windows/app/src-tauri/src/core/service/mod.rs:554 | bounded SCM reads refuse late concurrent repair | ok |
| REG-911 | Windows Service | — | apps/windows/service/src/bin/install_service/update_executor.rs:468 | publication clock gates successor incarnation | ok |
| REG-902 | Windows Service | — | apps/windows/service/src/bin/service.rs:422 | SCM stop hint refresher exits and joins bounded | ok |
| REG-873 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:362 | record absence still stops supervised Core | ok |
| REG-866 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:339 | unconfirmed stop reinstalls protected DNS | ok |
| REG-812 | Windows Service | — | apps/windows/service/src/core/windows_kill_switch.rs:1992 | poisoned ARMED lock uses recovery accessor | ok |
| REG-792 | Windows Service | — | apps/windows/service/src/core/server/mod.rs:561 | stop release strict/narrow and DNS guards retained | ok |
| REG-775 | Windows Service | — | apps/windows/service/src/core/runtime.rs:79 | corrupt record quarantine follows orphan proof | ok |
| REG-779 | Windows update cleanup | P1 | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:275 | Automatic failed-Prepare update Disconnect drops narrow intent | regression-fixed #1040 |
| REG-793 | Windows update cleanup | P1 | apps/windows/service/src/core/update.rs:670 | Early staging error bypasses post-stop AI cleanup and App pending route uses plain release | regression-fixed #1040 |
| REG-777 | Windows DIRECT expiry | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3664 | Committed DIRECT expiry applies AI hold twice after #974 | concern: verified duplicate native remove/apply gap; fix queued |
| R3REGW-DIRECT-DOUBLE-HOLD | Windows DIRECT expiry | P2 | apps/windows/service/src/core/windows_kill_switch.rs:3664 | Second selective apply removes already-active AI hold while general traffic is open | concern: verified; P2 transient exposure window |
| REG-951 | Windows Activity | — | apps/windows/app/src/pages/tono/activity-model.ts:129 | Object.hasOwn admits only declared string process families | ok |
| REG-932 | Windows account UI | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:54 | account/device cache uses current process and sign-in generation; nil scope disables fetch | ok |
| REG-984 | Windows singleton | — | apps/windows/app/src-tauri/src/utils/server.rs:100 | authenticated loopback notification bypasses inherited external proxies | ok |
| REG-820 | Windows status subscription | — | apps/windows/app/src/services/tono.ts:882 | live listener reused; pending registration/last-owner teardown retained | ok |
| REG-857 | Windows parser tests | — | apps/windows/crates/tono-core/src/node.rs:593 | bounded test additions only; no production parser behavior changes | ok |
| R3REGW-UPDATE-DISCONNECT-AI-HOLD | Windows update cleanup | P1 | apps/windows/service/src/core/update.rs:670 | Automatic pending-update release loses AI-hold disposition | real-fixed #1040 |
