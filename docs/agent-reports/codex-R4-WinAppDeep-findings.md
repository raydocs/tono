# R4-WinAppDeep: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1107 | hunt/sol-r4wapp-stable-installation-id | - | yes | fix(windows): require a durable installation identity before sign-in |
| 1111 | hunt/sol-r4wapp-quit-resync-generation | needs-hardware | yes | fix(windows): keep cancelled-Quit resync within its connection generation |
| 1116 | hunt/sol-r4wapp-direct-skip-generation | needs-hardware | yes | fix(windows): keep stale DIRECT discovery out of successor state |
| 1128 | hunt/sol-r4wapp-tunnel-server-response | - | yes | fix(windows): preserve API server errors received through the tunnel |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-INSTALLATION-ID-DURABILITY | Windows account | P1 | account.rs:86-100 (baseline) | Unknown or undurable installation identity can enroll a phantom device and evict another device | real-fixed #1107; auto-merge enabled, native CI blocked before tests by known checkout issue #1100 |
| WIN-QUIT-STALE-RESYNC | Windows quit/update | P2 | commands/quit.rs:427 | Cancelled-quit Service read can reset a successor connection without a generation fence | real-fixed #1111; merged, all hosted CI passed, needs-hardware |
| WIN-DIRECT-STALE-SKIP | Windows connection | P2 | connection/direct.rs:1511 | Late optional DIRECT discovery clears a successor overlay and interface evidence | real-fixed #1116; merged, all hosted CI passed, needs-hardware |
| R4WAPP-QUIT-AI-HOLD | Windows quit | P1 | commands/quit.rs:331 | Plain Quit removes selective AI hold | duplicate #1052; product decision covers Windows |
| R4WAPP-UPDATE-TOKEN-FLUSH | Windows update | P2 | commands/update.rs | Native executor termination bypasses ordinary Quit token flush | duplicate #1055 |
| R4WAPP-UPDATE-CAPTURE-CLEANUP | Windows update | P2 | commands/update.rs | Executor token capture refusal bypasses cleanup | duplicate #1082 |
| R4WAPP-UNARMED-SELECTION | Windows connection | P2 | connection/unarmed_probe.rs:132 | Background proof overwrites newer user selection | duplicate #1094 / #1098 |
| R4WAPP-UNARMED-LOOP | Windows connection | P2 | connection/unarmed_probe.rs:157 | TCP-success/TLS-failure retry loop repeats arming | duplicate #1054; fixed separately in #1106 |
| R4WAPP-DIRECT-WRITER-RELEASE | Windows connection | P2 | connection/monitor.rs | Automatic release waits behind DIRECT reload | duplicate #1051 / #1046 |
| R4WAPP-DOUBLE-RELEASE | Windows connection | P3 | connection.rs | Self-heal double release and stale recovery preflight selection | duplicate #798 |
| R4WAPP-VAULT-RETRY | Windows credentials | P1 | credentials.rs | Failed refresh writes disappear | duplicate #843; current writer retains latest failed mutations |
| R4WAPP-GRANT-FLUSH-QUEUE | Windows credentials | P2 | offline_grant.rs:512 | Timed-out grant flush barriers fill writer queue | duplicate #1056 |
| R4WAPP-LEGACY-UPDATE | Windows update | — | commands/quit.rs:141 | Legacy update failure appears to strand protection | false-positive: command is unregistered and has no active callers |
| R4WAPP-EXIT-CANCELS-RELEASE | Windows quit | — | commands/quit.rs | Quit timeout cancels Service cleanup | false-positive: dispatched Service handler owns cleanup independently |
| R4WAPP-MISSING-TOKEN-BLOCK | Windows restore | — | commands/restore.rs | Missing refresh token skips a surviving barrier | false-positive: tri-valued protection probe and account-close release guard it |
| R4WAPP-UNARMED-STOP-HOLD | Windows connection | — | connection.rs:684 | Unarmed StopClash removes an existing AI hold | false-positive: transition_after_stop returns when ARMED is absent |
| R4WAPP-OLD-MONITOR | Windows monitor | — | state.rs:165 | Old monitor survives a replacement rebuild | false-positive: task-ID-aware registration aborts displaced monitors |
| R4WAPP-LATE-MONITOR | Windows monitor | — | connection/monitor.rs | Late monitor permanently replaces successor supervision | false-positive: successor registration and generation checks fence it |
| R4WAPP-ROTATED-EXIT-OUTAGE | Windows catalog | — | catalog_sync.rs | Same-name credential rotation causes permanent outage | false-positive: health release and unarmed recovery capture the latest catalog |
| R4WAPP-SIGNIN-FLUSH-QUEUE | Windows credentials | — | commands/account.rs | Sign-in durability retries fill the vault queue | false-positive: one flush future is pinned across waits |
| R4WAPP-SESSION-MARKER-UNDO | Windows credentials | — | credentials.rs | Overlapping switch refusal loses old session marker | false-positive: marker transfers undo ownership and commit responsibility |
| R4WAPP-ADOPT-AFTER-WRITE | Windows account | — | commands/account.rs | Adoption fails after queuing replacement token | false-positive: ApiClient::adopt has no fallible step after queueing |
| R4WAPP-ACCOUNT-CATALOG | Windows account | — | commands/account.rs | Account B dials cached account A catalog | false-positive: replacement discards catalog and retires live runtime |
| R4WAPP-GRANT-TOMBSTONE | Windows grants | — | offline_grant.rs | Old tombstone overwrites successor grant | false-positive: identity/token fences and grant-file mutex guard it |
| R4WAPP-POLICY-ACCOUNT | Windows catalog | — | catalog_sync.rs | Traffic policy leaks across account switch | false-positive: traffic policy is intentionally global |
| R4WAPP-SUSPEND-HEALTH | Windows monitor | — | connection/monitor.rs | Suspension plus health failure strands broad protection | false-positive: current automatic release retains AI hold and opens general traffic |
| R4WAPP-MISSING-REFRESH | Windows account | — | commands/account.rs | Missing auth refresh token preserves old identity | false-positive: production passwordless response always supplies refresh token |
| R4WAPP-CI-RESERVED-AUX | Windows CI | P2 | docs/agent-reports/2026-10-01-orchestration/scripts/merge-manager/aux.sh:1 | Main archive filename prevents Windows checkout before native tests | duplicate #1100; initial #1107 native checkout failed; later PRs passed after separate path fix |
| WIN-ACCOUNT-REPLACEMENT-AI-HOLD | Windows account | P1 decision | commands/account.rs:484-499; connection/disconnect.rs:78 | Replacement sign-in retires an old live runtime with full AI release | real-unfixed decision issue #1120; existing sign-out semantics conflict with TOP RULE interpretation |
| R4WAPP-IPC-QUEUED-START | Windows Service client | — | service/src/client/mod.rs:115-123 | Detached queued IPC might send an old StartClash after release | false-positive: ordinary pre-send work retains the mutation reader; harmful unsent late work needs unproved worker-pool saturation |
| R4WAPP-STALE-HYDRATION | Windows account | — | commands/account.rs:68-80 | Overlapping credential hydration latches a stale completion | false-positive: normal UI serializes retry admission; no independent real trigger established |
| R4WAPP-AUTH-TUNNEL-PORT | Windows connection | — | connection.rs:641 | Retired failure clears the successor auth fallback proxy port | false-positive: no persistent network impact proved; requires replacement overlap plus direct API failure |
| R4WAPP-PREFLIGHT-SUSPENSION | Windows connection | — | connection.rs:257-332 | Recovery preflight misses an account suspension while awaiting proof | false-positive: bounded 2.5s overlap; no sustained outage or additional credential access proved |
| R4WAPP-LOG-UTF8 | Windows Service client | — | core/service/mod.rs:308 | Hex log snapshot slicing can panic on malformed UTF-8 boundaries | false-positive: trusted Service producer always emits ASCII hex; no realistic malformed input trigger |
| R4WAPP-SCM-WORKERS | Windows Service client | — | core/service/mod.rs:554 | Repeated timed-out SCM reads accumulate worker threads | false-positive: periodic verifier is single-flight after #933; repeated user-operation saturation unproved |
| R4WAPP-PRIVILEGED-CANCEL | Windows Service client | — | core/runstate/operation.rs | Cancelled privileged helper releases an unsafe operation slot | false-positive: uncertainty is set before awaiting helper; drop quarantines the slot |
| R4WAPP-VERSION-DEADLINE | Windows Service client | — | core/service/mod.rs:124 | Interactive version timeout rejects usable Service capability | false-positive: lock-free version handler is cheap; no realistic material delay proved |
| R4WAPP-STALE-HEALTH-RELEASE | Windows monitor | P2 | connection/monitor.rs:1397-1412 | Old exit health proof releases a hot-switched successor | duplicate #1093 / #1095 |
| R4WAPP-UNARMED-TIMEOUT | Windows connection | P2 | connection/unarmed_probe.rs:149-159 | Overall timeout ends the sole automatic recovery owner | duplicate #1101 |
| R4WAPP-JOINED-AI-REMOVE | Windows release | P2 | connection/disconnect.rs | Explicit AI removal request joins automatic narrow release and loses its disposition | duplicate #1109 |
| WIN-TUNNEL-5XX-ANSWER | Windows transport | P2 | tono/transport.rs:624-631 (baseline718eda43) | Authenticated tunneled API 5xx loses its response and answer counter | real-fixed #1128; merged, all hosted CI passed |
| R4WAPP-COLD-LAUNCH-AI-HOLD | Windows restore | — | commands/restore.rs:45-53,452-465 | Signed-out cold launch clears an existing narrow AI hold | false-positive: wanted=false is ProvenAbsent; NoToken does not dispatch release |
| R4WAPP-ARMED-PENDING-MARKER | Windows credentials | P2 | commands/restore.rs:452-465 | Pending undurable sign-in marker plus armed protection releases on relaunch | duplicate #642 / CR4459-codex-F2 / decision010; deliberate known NoToken recovery limit |
| R4WAPP-VAULT-LOCK-CYCLE | Windows credentials | — | credentials.rs; offline_grant.rs | Vault and product identity/file locks deadlock on account switching | false-positive: file-lock holders do not await product/client identity locks |
| WIN-LATE-TIMEOUT-AI-HOLD | Windows connection cleanup | P2 | connection/cleanup.rs:45-56,143-144 | Automatic timeout followed by late successful StartClash compensation removes the AI floor | real-unfixed #1134; native sleep ordering and release-cause qualification needed |
| R4WAPP-VAULT-QUEUE-ATOMICITY | Windows credentials | — | credentials.rs:780-786 | A full persistence queue changes memory to an unpersisted replacement token | false-positive: mutate admits the queued mutation before committing memory |
