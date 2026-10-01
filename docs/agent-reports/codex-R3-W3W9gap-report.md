Six new P2 findings fixed across five merged PRs. No new P0/P1 proved. The fixes preserve AI blocking and strict-mode behavior.

File positions below refer to the audited baselines. Full evidence is in the [merged audit report](https://github.com/raydocs/tono/blob/main/docs/agent-reports/codex-R3-W3W9gap-report.md).

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-CORE-REAPER-PID-REUSE | W3 | P2 | process.rs:637→565 | Orphan sweep discards creation identity before termination | Fixed #994 |
| WIN-WATCHDOG-TIMEOUT-PID-REUSE | W3 | P2 | manager.rs:826→1101 | Confirmed-dead PID remains during cleanup waits | Fixed #999 |
| WIN-SCM-PID-FALLBACK | W9 | P2 | bin/shared/mod.rs:160 | Stale Service PID can target another executable | Fixed #1004 |
| WIN-WATCHDOG-ABORT-PID-REUSE | W3 | P2 | manager.rs:1099→1106 | Watchdog abort releases the original handle before PID fallback | Fixed #1012 |
| WIN-OWNER-TAKEOVER-STALE-PID | W3 caller | P2 | owner.rs:57→78 | Owner exits during health wait; stale PID is still killed | Fixed #1022 |
| WIN-OWNER-CLEANUP-LIVE-PIDFILE | W3 caller | P2 | owner.rs:85→87 | Failed takeover deletes successor PID metadata | Fixed #1022 |
| WIN-CORE-JOB-SPAWN-WINDOW | W3 | P2 | manager.rs:1190→1225 | Service crash before Job assignment can leave an orphan Core | Real-unfixed: atomic launcher and native regression unfinished; startup sweep mitigates |
| WIN-PROXY-RESET-JOIN | W3 | P2 | sysopt.rs:109 | Concurrent proxy clear returns early | Duplicate #925; already fixed |
| WIN-STARTCLASH-FAILURE | W3 | P1 | logger.rs:34 | Disk-full log setup failure leaves WFP armed | Duplicate #769 |
| BRICK-W3 | W9 | P1 | uninstall_service.rs:650 | Failed disarm still removes Service registration/binary | Duplicate known BRICK-W3 |
| BRICK-W4 | W9 | P1 | uninstall_service.rs:584 | Exit4 permits inexact DNS restoration | Duplicate documented limitation; decision boundary |
| R3PROC-FP-PROXY-APPLY | W3 | — | proxy.rs:258 | Core crash leaves newly enabled Windows proxy | False positive: Windows backend does not enable it |
| R3PROC-FP-PROXY-STOP | W3 | — | server/mod.rs:258 | Proxy cleanup prevents Core stop | False positive: successful Windows no-op |
| R3PROC-FP-PROXY-GUARD | W3 | — | sysopt.rs:50 | Proxy guard resurrects stale settings | False positive: guard is never started |
| R3PROC-FP-PROXY-OTHER | W3 | — | sysopt.rs:191 | Cleanup disables unrelated proxy | False positive: ownership check preserves it |
| R3PROC-FP-PROXY-FORMS | W3 | — | sysopt.rs:191 | Cleanup misses alternate proxy formats | False positive: no ordinary Tono producer |
| R3PROC-FP-LOG-DEADLOCK | W3 | — | manager.rs:1234 | Writer lock and queue deadlock | False positive: lock drops before await |
| R3PROC-FP-LOG-BACKLOG | W3 | — | tono-logger/src/lib.rs:101 | Log queue grows without bound | False positive: bounded to 100 entries |
| R3PROC-FP-PARTIAL-CHILD | W3 | — | manager.rs:1209 | Setup error leaves untracked Core | False positive: bounded kill/Job cleanup covers errors |
| R3PROC-FP-LEGACY-RUNTIME | W9 | — | windows_legacy_cleanup.rs:72 | Legacy cleanup deletes live runtime | False positive: separate ProgramData root |
| R3PROC-FP-LEGACY-PROVIDERS | W9 | — | windows_legacy_cleanup.rs:131 | Cleanup deletes required provider assets | False positive: managed assets/providers are empty |
| R3PROC-FP-LEGACY-HANG | W9 | — | legacy_cleanup.rs:74 | Cleanup holds disconnect forever | False positive: caller and worker are bounded |
| R3PROC-FP-LEGACY-LINKS | W9 | — | windows_legacy_cleanup.rs:115 | Cleanup escapes through junctions | False positive: reparse/root guards; deliberate swapping excluded |
| R3PROC-FP-LEGACY-INSTALLER | W9 | — | service/resources/installer.nsi:18 | NSIS skips network cleanup | False positive: unused template |
| R3PROC-FP-LEGACY-MARKER | W9 | — | legacy_cleanup.rs:30 | Bad marker skips network cleanup | False positive: marker controls housekeeping only |
| R3PROC-FP-UNINSTALL-NRPT | W9 | — | uninstall_service.rs:731 | Uninstall succeeds with catch-all NRPT | False positive: continuing outcomes prove removal |
| R3PROC-FP-UNINSTALL-DELETE | W9 | — | app/installer.nsi:929 | Failed cleanup deletes installed files | False positive: NSIS aborts failed/unknown outcomes |
| R3PROC-FP-UNINSTALL-UPDATE | W9 | — | uninstall_service.rs:792 | Cleanup deletes active update executors | False positive: maintenance and store locks protect them |
| R3PROC-FP-UNINSTALL-PROXY | W9 | — | app/installer.nsi:1574 | GUI termination leaves newly applied proxy | False positive: Windows never enables that proxy |

All PRs merged with merge commits and required CI green.

| PR | Change | Auto-merge | Labels |
|---|---|---|---|
| [#994](https://github.com/raydocs/tono/pull/994) | Verified Core orphan termination | Enabled | `needs-hardware` |
| [#999](https://github.com/raydocs/tono/pull/999) | Retire confirmed-dead Core PID | Enabled | `needs-hardware` |
| [#1004](https://github.com/raydocs/tono/pull/1004) | Verify Service image before escalation | Enabled | `needs-hardware` |
| [#1012](https://github.com/raydocs/tono/pull/1012) | Bind watchdog fallback to cached identity | Enabled | `needs-hardware` |
| [#1022](https://github.com/raydocs/tono/pull/1022) | Protect owner takeover and successor metadata | Enabled | `needs-hardware` |
| [#1026](https://github.com/raydocs/tono/pull/1026) | Audit report and remaining finding | Enabled | None |

Examined **29 hypotheses**: **18 false positives, 4 duplicates, 6 fixed findings, 1 real-unfixed finding**.

Reaper, watchdog and owner regressions failed before their fixes and passed afterward. Targeted Linux tests and Windows compilation checks passed; native Windows CI passed. One additional crash-loop fixture fails before Core spawn on both patched and unchanged baseline, disclosed in #1012.

All assigned files were reviewed. Remaining work is the atomic Core/Job launcher fix and native crash regression, plus real-device validation of the merged network-related changes.