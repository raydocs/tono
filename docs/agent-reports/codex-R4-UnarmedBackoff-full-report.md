Fixed the P1 failed-connect retry loop in PR #1106. It merged through green CI at 2026-10-01 06:20:44 UTC (merge commit 520294ad); needs-hardware applied and MERGE auto-merge completed.

| ID | area | severity | file:line | one-line description | verdict |
|---|---|---|---|---|---|
| R4UB-WIN-FAILED-CONNECT-BACKOFF | Windows unarmed probe | P1 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:157 | Reachable TCP plus failed full connect resets backoff and repeatedly arms/releases WFP | real-fixed #1106; merged 520294ad; needs-hardware; merge-commit auto-merge completed; CI green |
| R4UB-WIN-UNARMED-SELECTION | Windows unarmed probe | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:132 | A late TCP proof overwrites a newer idle user selection | duplicate of #1098; overlapping guard/test removed |
| WIN-UNARMED-TIMEOUT-OWNER | Windows unarmed probe | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:155 | Overall connection timeout retires generation twice and ends the sole automatic retry owner | real-unfixed #1101; timeout ownership is separate; native sleep regression needed |
| R4UB-FP-HEALTH-SUCCESSOR-RELEASE | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Old health release could tear down a successor after Disconnect/cold switch | false-positive: Disconnect/switch abort registered tasks; policy callers use guarded protected path |
| R4UB-FP-ORDINARY-RETRY-BUDGET | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/reconnect.rs:296 | Retry budget could strand ordinary broad blocking | false-positive: failure releases with AI hold before another delay; strict hold is deliberate |
| R4UB-FP-INPLACE-OUTAGE-HOLD | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:838 | Service outage in-place hold could conceal tunnel death | false-positive: fresh data-plane proof after 15s and failure terminates hold |
| R4UB-FP-TUN-EVENT-LOOP | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1084 | Own TUN events could continuously restart healthy Core | false-positive: two failed event proofs required; successful connect resets baselines |
| R4UB-FP-VANISHED-DIRECT-UPLINK | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1325 | DIRECT could remain bound to a lost uplink | false-positive: committed interface must remain in usable physical uplinks |
| R4UB-FP-IDLE-RESYNC | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:642 | Idle Protected Offline could remain unwatched | false-positive: registered 30s Service-truth poll checks generation |
| R4UB-FP-OLD-STATUS-PUBLISH | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:972 | Slow probe could publish obsolete kill-switch snapshot | false-positive: captured generation and fresh aggregate govern publication |
| R4UB-FP-DEFERRED-POLICY | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1268 | Policy updates during Connecting could disappear | false-positive: generation-owned deferral consumed at commit or rebuild |
| R4UB-DUP-DIRECT-WRITER | Windows health monitor | P2 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | DIRECT reader can delay automatic restoration | duplicate of #1051 / WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO; known decision item |
| R4UB-DUP-PROTECTED-PREFLIGHT | Windows reconnect | P1 | apps/windows/app/src-tauri/src/tono/connection.rs:440 | Protected re-entry tries App TCP preflight | duplicate of #1070 |
| R4UB-DUP-DOUBLE-RELEASE | Windows reconnect | P1 | apps/windows/app/src-tauri/src/tono/connection.rs:272 | Failure cleanup can release twice and admit stale selection | duplicate of #798 |
| R4UB-FP-PROBE-SELF-ABORT | Windows unarmed probe | — | apps/windows/app/src-tauri/src/tono/connection.rs:332 | Connect admission could abort its own unarmed owner | false-positive: retire_connection_generation is intentionally abort-free |
| R4UB-FP-LATE-HANDLE-INSTALL | Windows unarmed probe | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:50 | Delayed handle registration could resurrect disconnected probe | false-positive: generation check retires task; ticket fences newer starters |
| R4UB-FP-EXPLICIT-CONNECT-WAIT | Windows unarmed probe | — | apps/windows/app/src-tauri/src/tono/connection.rs:227 | Explicit Connect could inherit background cooldown | false-positive: direct Connect bypasses Schedule and retires its generation |
| R4UB-FP-STRICT-UNARMED | Windows unarmed probe | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:201 | Strict barrier could enter ordinary unarmed recovery | false-positive: fail-open dispatch and barrier guards forbid armed admission |
| R4UB-DUP-STALE-HOTSWITCH-HEALTH | Windows health monitor | P2 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Old exit health proof can release a successfully hot-switched replacement | duplicate of #1095; same-generation switch differs from cold-switch false positive |
| R4UB-DUP-WINDOWS-CHECKOUT | Windows CI | P2 engineering | docs/agent-reports/2026-10-01-orchestration/scripts/merge-manager/aux.sh:1 | Reserved AUX basename prevents native Windows checkout before compilation | duplicate of #1100; main ca5df8fc removed path; latest native checkout passed; gates intact |
| R4UB-FP-SAMPLER-SHUTDOWN | Windows unarmed probe | — | apps/windows/app/src-tauri/src/main.rs:13 | A hung native sampler could make Tokio runtime shutdown wait forever | false-positive: committed App::run exit calls Tao Windows process::exit; runtime Drop is not reached after sampler starts |

PR: https://github.com/raydocs/tono/pull/1106 — `hunt/sol-r4ub-unarmed-backoff`; label `needs-hardware`; auto-merge yes (MERGE), completed.

13 false positives, 6 duplicates, 21 total hypotheses. Two new verified product findings: one fixed in #1106, one unfixed (#1101).

Local checks: 330 core unit + 15 integration tests and two portable observer regressions passed. Native Windows Tauri/Service/core/frontend and all required macOS gate jobs passed in run 36822709263. Hardware acceptance remains required.

Unfinished: #1101 timeout-owner handling requires a separate authoritative ownership fix and native sleep regression. Assigned unarmed/reconnect/health paths were audited; real-device WFP/DNS/uplink behavior could not be exercised on Linux.
