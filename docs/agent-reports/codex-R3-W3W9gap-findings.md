# R3-W3W9gap: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:24 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 994 | hunt/sol-r3proc-verified-reaper | needs-hardware | yes | fix(windows): verify Core identity before orphan termination |
| 999 | hunt/sol-r3proc-watchdog-dead-pid | needs-hardware | yes | fix(windows): retire confirmed dead Core PID before cleanup |
| 1004 | hunt/sol-r3proc-service-pid-image | needs-hardware | yes | fix(windows): verify Service image before PID escalation |
| 1012 | hunt/sol-r3proc-watchdog-identity | needs-hardware | yes | fix(windows): bind watchdog timeout cleanup to Core identity |
| 1022 | hunt/sol-r3proc-owner-takeover | needs-hardware | yes | fix(windows): verify owner takeover before killing or cleanup |
| 1026 | hunt/sol-r3proc-report | none | yes | docs: W3 W9 audit and remaining Core Job creation window |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R3PROC-FP-PROXY-APPLY | W3 | — | proxy.rs:258 | A core crash leaves a newly enabled Windows system proxy | false-positive Windows backend is macOS-only and App sends None |
| R3PROC-FP-PROXY-STOP | W3 | — | server/mod.rs:258 | Proxy cleanup failure prevents Windows Core stop | false-positive successful no-op on Windows |
| R3PROC-FP-PROXY-GUARD | W3 | — | app/core/sysopt.rs:50 | Proxy guard can resurrect stale proxy or hang reset | false-positive guard is never started in current product |
| R3PROC-FP-PROXY-OTHER | W3 | — | app/core/sysopt.rs:191 | Cleanup disables unrelated manual/PAC proxy | false-positive ownership match preserves unrelated endpoints |
| R3PROC-FP-PROXY-FORMS | W3 | — | app/core/sysopt.rs:191 | Legacy IPv6/protocol-specific proxy forms missed | false-positive no ordinary Tono producer of those forms |
| WIN-PROXY-RESET-JOIN | W3 | P2 | app/core/sysopt.rs:109 | Concurrent proxy clear returns early | duplicate #925 fixed in current source |
| R3PROC-FP-LOG-DEADLOCK | W3 | — | manager.rs:1234 | Output writer and log queue deadlock stop | false-positive writer guard drops before log queue await |
| R3PROC-FP-LOG-BACKLOG | W3 | — | tono-logger/src/lib.rs:101 | Log queue grows without bound | false-positive wrapping queue holds 100 entries; huge individual line trigger unproved |
| R3PROC-FP-PARTIAL-CHILD | W3 | — | manager.rs:1209 | Post-spawn setup error leaves untracked core | false-positive bounded kill or drop closes kill-on-close Job |
| WIN-STARTCLASH-FAILURE | W3 | P1 | logger.rs:34 | Disk-full log setup failure leaves WFP armed | duplicate #769 |
| R3PROC-FP-LEGACY-RUNTIME | W9 | — | windows_legacy_cleanup.rs:72 | Legacy walk deletes live Core runtime or logs | false-positive live state uses separate ProgramData owner root |
| R3PROC-FP-LEGACY-PROVIDERS | W9 | — | windows_legacy_cleanup.rs:131 | Deleting legacy provider source breaks reconnect | false-positive managed product sends empty assets/providers |
| R3PROC-FP-LEGACY-HANG | W9 | — | legacy_cleanup.rs:74 | Legacy cleanup holds disconnect lock forever | false-positive 20-second caller timeout and bounded worker |
| R3PROC-FP-LEGACY-LINKS | W9 | — | windows_legacy_cleanup.rs:115 | Legacy cleanup escapes root through junction | false-positive reparse/handle-root guards; deliberate swap outside ordinary failures |
| R3PROC-FP-LEGACY-INSTALLER | W9 | — | service/resources/installer.nsi:18 | Service-only NSIS deletes binaries without network cleanup | false-positive unused template; current packaging selects App template |
| R3PROC-FP-LEGACY-MARKER | W9 | — | legacy_cleanup.rs:30 | Damaged legacy marker skips required network cleanup | false-positive marker governs only housekeeping |
| BRICK-W3 | W9 | P1 | uninstall_service.rs:650 | Failed disarm still deletes SCM registration and Service binary | duplicate known BRICK-W3; no fix in this hunt |
| BRICK-W4 | W9 | P1 | uninstall_service.rs:584 | Explicit uninstall exit4 permits inexact/stopped-resolver DNS | duplicate documented BRICK-W4 limitation; decision boundary |
| R3PROC-FP-UNINSTALL-NRPT | W9 | — | uninstall_service.rs:731 | Uninstall succeeds with NRPT catch-all present | false-positive every continuing outcome repeats bounded removal proof |
| R3PROC-FP-UNINSTALL-DELETE | W9 | — | app/installer.nsi:929 | Failed cleanup deletes all installed product files | false-positive NSIS aborts unknown/failed outcomes |
| R3PROC-FP-UNINSTALL-UPDATE | W9 | — | uninstall_service.rs:792 | Final cleanup deletes live update executors | false-positive maintenance gate plus locked pending-store refusal |
| R3PROC-FP-UNINSTALL-PROXY | W9 | — | app/installer.nsi:1574 | Uninstall GUI kill leaves newly applied system proxy | false-positive Windows product never enables proxy |
| WIN-CORE-REAPER-PID-REUSE | W3 | P2 | process.rs:637 -> process.rs:565 | Orphan sweep discards creation identity and can kill reused PID | real-fixed #994; merged; exact-head ci-gate and native Windows service passed |
| WIN-WATCHDOG-TIMEOUT-PID-REUSE | W3 | P2 | manager.rs:826 -> 1057 -> 1101 | Confirmed-dead Core PID remains while metadata/WFP cleanup waits | real-fixed #999; merged; baseline failed then 5 manager tests passed; exact-head ci-gate passed |
| WIN-SCM-PID-FALLBACK | W9 | P2 | bin/shared/mod.rs:160 | Stale PID-file escalation can target another process | real-fixed #1004; merged; 39 Linux bin tests and exact-head native ci-gate passed |
| WIN-CORE-JOB-SPAWN-WINDOW | W3 | P2 | manager.rs:1190 -> manager.rs:1225 (ad53abb6) | Service crash between Core creation and Job assignment leaves an unbound Core | real-unfixed documented in merged #1026; atomic Windows launcher/native regression unfinished; SCM restart sweep mitigates; P2 |
| WIN-WATCHDOG-ABORT-PID-REUSE | W3 | P2 | manager.rs:1099 -> manager.rs:1106 | Abort closes live Core Job before raw PID fallback can reopen | real-fixed #1012; merged; actual timeout baseline failed then 6 manager tests passed; exact-head ci-gate passed |
| WIN-OWNER-TAKEOVER-STALE-PID | W3 caller | P2 | owner.rs:57 -> owner.rs:78 | Owner exits during health wait but raw old PID still killed | real-fixed #1022; merged; baseline failed then 4 owner tests passed; exact-head native ci-gate passed |
| WIN-OWNER-CLEANUP-LIVE-PIDFILE | W3 caller | P2 | owner.rs:85 -> owner.rs:87 | Failed takeover deletes a successor owner PID file before lock acquisition | real-fixed #1022; merged; baseline failed then 4 owner tests passed; exact-head native ci-gate passed |
