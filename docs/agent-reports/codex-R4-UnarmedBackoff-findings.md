# R4-UnarmedBackoff: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:48 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4UB-WIN-FAILED-CONNECT-BACKOFF | Windows unarmed probe | P1 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:157 | Reachable TCP plus failed full connect resets backoff and repeatedly arms/releases WFP | real-verified; fix ready for PR; claimed #1054 |
| R4UB-WIN-UNARMED-SELECTION | Windows unarmed probe | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:132 | A late TCP proof overwrites a newer idle user selection | duplicate of #1098; overlapping guard/test removed |
| WIN-UNARMED-TIMEOUT-OWNER | Windows unarmed probe | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:155 | Overall connection timeout retires generation twice and ends the sole automatic retry owner | real-unfixed #1101; timeout ownership is separate; native sleep regression needed |
| R4UB-FP-HEALTH-SUCCESSOR-RELEASE | Windows health monitor | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Automatic health release could tear down successor | false-positive: Disconnect/switch abort registered tasks; policy callers use guarded protected path |
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
