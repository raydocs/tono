| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Automatic health release never cancels a stalled optional DIRECT controller reader, delaying ordinary internet recovery for two 60-second attempts | in-PR | #1051 / #1329 | 中·已确认（P1，源码与锁回归） | Not reproduced on hardware (needs-hardware). The 60 s reload grace before the health proof may fail is unchanged. The policy-rebuild and strict recoveries still queue behind the reader. A queued policy writer and the DIRECT commit owner's proofs still delay the release |

Ownership: SHIP_PLAN §2 item 10. Follow-up to merged #898; ordinary-health AI disposition is #974/#1003/#1010.

Trigger and path: an optional DIRECT reload after Connected holds App lifecycle reader admission (`apps/windows/app/src-tauri/src/tono/connection/direct.rs:1185–1199`), while the authenticated Core `/configs` handler accepts but never replies. Its two 60-second HTTP attempts hold the reader. After the owned-reload grace expires and health proof fails, `connection/monitor.rs:1397–1411` dispatches applying-narrow release but only aborts reconnect. It never retires or cancels the captured connection token. `connection/disconnect.rs:144–155` registers release and waits for the writer; it cannot dispatch the Service release until DIRECT finishes. The 55-second wait expires first. Ordinary traffic remains Blocked during the wait. Explicit Restore already invalidates the connection and wakes the controller wait after #898; that does not cover this automatic caller.

Evidence: exact production `release_after_health_failure` in a Linux Cargo extraction with a real Tokio lifecycle reader/writer and the existing cancellation-token wait contract. The regression requires automatic writer admission; baseline fails after its bounded 200ms observation with `cancelled=false`. This is source/control-flow evidence; no native WFP or customer incident is claimed.

No code fix: the current Service release deletes every kill-switch-provider filter at `service/src/core/windows_kill_switch.rs:2800`, then requests `selective_layer::finish_release(true)` at `:2848`. `selective_layer.rs:51–69` bounds only the wait, and native command/NRPT failures are logged without proving installation. Even installing the current layer earlier cannot cover cached addresses, existing connections or clients bypassing system NRPT, as `docs/selective-fail-open.md` describes. Cancellation-only therefore advances the AI exposure window. Waiting for that best-effort hold to succeed instead can strand ordinary traffic. Broad CDN/IP blocking would block unrelated internet. These alternatives conflict with the user's top rule.

Decision item: define an implementable, durable AI-service hold and an atomic transition that opens ordinary traffic without exposing AI or retaining a full block when secondary installation fails. The older decision `docs/decisions/036-2026-09-30-crash-hang-releases-then-ai-layer.md:4–5` accepts exposure; this run's explicit top rule supersedes that allowance. Strict mode must keep its existing full block. No change to that decision record or native network behavior is made here.

2026-10-02: the blocker above is gone on main. Since #1271 the Service installs the AI hold while WFP still blocks
(`hold_ai_before_release`), so when the hold installs, waking the reader no longer opens AI traffic before it (a hold that fails
or times out still lets the release go on, unchanged). `admit_health_release` now queues the lifecycle
writer and, when a reader is in the way, cancels this generation's controller waits (`cancel_connection_waits`) without retiring the
generation. The DIRECT owner still retracts its Service session before dropping the reader. Regression:
`health_release_admission_wakes_a_stalled_controller_reader`. The wake repeats every 250 ms until the writer is admitted
(`health_release_admission_wakes_a_reader_that_reads_its_token_late`). Open: a policy writer queued ahead of the release, and the
DIRECT commit owner's controller and TUN proofs, still delay it.
