# R3 W3/W9 process and uninstall review — GPT-6.1 Sol

2026-09-30 MDT. Slot R3-W3W9gap. SHIP_PLAN §2 item 10. Read the assigned process/proxy, manager callers, uninstall, legacy cleanup and packaged NSIS sections end to end, with independent read-only reviews of proxy/legacy/uninstall and process lifecycle callers.

29 hypotheses: 18 false positives, 4 known duplicates, 6 newly verified P2s fixed across five PRs, and one source-proven P2 left open. No new P0/P1 proved. Source fixes preserve existing AI-service blocking, strict-mode behavior and DNS/WFP release predicates. No deployment, publishing or local device-network mutation. Local file positions below refer to audited baselines recorded in the corresponding finding/PR; later commits move lines.

Fix PRs: #994 (orphan identity), #999 (confirmed-dead PID), #1004 (Service image), #1012 (watchdog cached identity), #1022 (owner handoff cluster). All non-draft, needs-hardware, merge-commit auto-merge enabled. At report creation #994/#999/#1004/#1012 are merged with required CI green; #1022 has native Service/core/app success and app-rust/aggregate CI pending. These states are evidence at this time, not a claim about later merging.

| ID | Area | Severity | File:line | Hypothesis / finding | Verdict |
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
| WIN-CORE-JOB-SPAWN-WINDOW | W3 | P2 | manager.rs:1190 -> manager.rs:1225 (ad53abb6) | Service crash between Core creation and Job assignment leaves an unbound Core | real-unfixed atomic Windows launcher/native regression unfinished; SCM restart sweep mitigates; P2 |
| WIN-WATCHDOG-ABORT-PID-REUSE | W3 | P2 | manager.rs:1099 -> manager.rs:1106 | Abort closes live Core Job before raw PID fallback can reopen | real-fixed #1012; merged; actual timeout baseline failed then 6 manager tests passed; exact-head ci-gate passed |
| WIN-OWNER-TAKEOVER-STALE-PID | W3 caller | P2 | owner.rs:57 -> owner.rs:78 | Owner exits during health wait but raw old PID still killed | real-fixed #1022; baseline failed then 4 owner tests passed; native CI pending |
| WIN-OWNER-CLEANUP-LIVE-PIDFILE | W3 caller | P2 | owner.rs:85 -> owner.rs:87 | Failed takeover deletes a successor owner PID file before lock acquisition | real-fixed #1022; baseline failed then 4 owner tests passed; native CI pending |

The open Job-at-creation window is described in [its finding fragment](../findings.d/WIN-CORE-JOB-SPAWN-WINDOW.md). A fatal parent crash skips Rust Drop between unsuspended spawn and AssignProcessToJobObject; no Service-wide inherited containment was found. SCM recovery plus startup installed-image sweep mitigates the orphan. Uninstall has no independent process-table reaper. Permanent outage would require additional failure; no P0/P1 or native reproduction is claimed. Atomic launch needs a broader Windows launcher change; [Rust's spawn_with_attributes is still nightly-only](https://doc.rust-lang.org/std/os/windows/process/trait.CommandExt.html#tymethod.spawn_with_attributes). [Microsoft documents this gap and the creation-time Job attribute](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812).

Verification:

- #994: stale-creation real-child regression failed on original bare termination, then four process tests and one positive startup-reconcile test passed.
- #999: real exiting-child/watchdog cleanup regression failed, then five manager tests passed.
- #1004: Windows foreign-child regression written first; native baseline not executable in VM. Existing Linux install/uninstall suites passed 17 + 22; Windows GNU binary/test cross-check passed. Hosted native Service CI passed.
- #1012: actual five-second timeout with stale creation identity killed the original fixture, then six manager tests passed; Windows GNU cross-check passed.
- #1022: two real-lock/real-child regressions failed (owner suite 2 passed / 2 failed), then all four owner tests passed, including existing healthy and stale owner positives. Windows GNU cross-check passed.
- git diff --check and Rust syntax parsing passed for each source delivery. No unrelated formatting/test/gate changes.
- Additional crash-loop integration failed at StartClash HTTP 400 before Core spawn on both patched and unmodified 1fb29265. Reported in #1012; test unchanged.

GNU cross-check is compilation evidence; native runtime and real-device network acceptance cannot run in this Linux VM. Windows hosted CI covers native builds/tests. Real PID reuse and the pre-Job crash were not forced on a real machine. The remaining atomic-launch change/native regression and final hardware acceptance are unfinished; all assigned source files were read. Known BRICK-W3/W4 remain duplicates/decision boundaries, not new findings or fixes in this slot.

Hunter: GPT-6.1 Sol (Codex CLI)
