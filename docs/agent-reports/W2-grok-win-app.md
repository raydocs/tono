# W2 Windows app hunt (Grok 4.7)

Slot W2-grok-win-app. Areas A2, A3, A4, A11 on `apps/windows`. A6 (update, quit, window, bootstrap, updater) was not started. Hunt start base: `origin/main` `ff81118a`. Later fix branches were cut from `5ba113d2` and `17580a26`. This report is against `origin/main` `84c11df1`.

No deploy, no publish, no jev-route. `cargo test` was not run: this VM has rustc 1.83 and the workspace needs 1.98 / edition 2024. Hosted Windows CI runs the tests.

Auto-merge was enabled once on each fix PR (`gh pr merge <N> --auto --merge` only). The merge manager may turn that off or on for queueing. This hunt does not turn it back on. This report is [#909](https://github.com/raydocs/tono/pull/909). It does not enable auto-merge. The label API returned HTTP 403 for this token; some PRs still show `needs-hardware` (added outside this token).

## Fixed

| ID | Area | Severity | File | One line | Verdict |
|---|---|---|---|---|---|
| WIN-WECHAT-AI-DIRECT | A11 / A4 | P0 / 高·已确认 | `tono-core/src/config.rs` non-home DIRECT branch; `connection/direct.rs` graph proof | Signed-app address-free TCP rules sent every destination, including assistant hosts, out the physical NIC when there was no home hop | [#871](https://github.com/raydocs/tono/pull/871) |
| WIN-HEAL-SIGNOUT-DIAL | A2 | P1 / 中·已确认 | `commands/account.rs` after `discard_account_catalog` | Self-heal dial survived sign-out because preferred name and residential id still matched | [#874](https://github.com/raydocs/tono/pull/874) |
| WIN-DEBOUNCE-DROPS-EVENT | A3 | P1 / 中·已确认 | `connection_health.rs`, `connection/monitor.rs` | A network or core change inside the 2s debounce was dropped, not deferred, so the next tick no longer saw it | [#878](https://github.com/raydocs/tono/pull/878) |
| WIN-DIRECT-DOWN-UPLINK | A4 | P1 / 中·推导 | `connection/platform.rs` `detect_physical_interface_windows` | DIRECT bind kept the first hardware alias and ignored `IfOperStatus` up | [#879](https://github.com/raydocs/tono/pull/879) |
| WIN-CONNECT-BUDGET-PREPARE | A2 | P1 / 中·已确认 | `connection/transaction.rs` | Cold-connect clock was 240s / 208s accounted and omitted PrepareCoreStart (65s) and residential browser DNS (5s), so a slow first connect timed out and released | [#884](https://github.com/raydocs/tono/pull/884) |
| WIN-WECHAT-PATH-STALE | A4 | P1 / 中·已确认 | `connection.rs` new-attempt reset | `applied_wechat_path_regexes` survived into a full-tunnel session, so a path change forced a protected reconnect every two minutes | [#900](https://github.com/raydocs/tono/pull/900) |

No open issue matched these bugs, so none of the PRs uses `Fixes #N`.

## Pull requests

Snapshot at report time. All six were open, non-draft, merge method MERGE, auto-merge enabled. If that flag is later off, leave it off.

| PR | Branch | Auto-merge at snapshot | `needs-hardware` |
|---|---|---|---|
| [#871](https://github.com/raydocs/tono/pull/871) | `hunt/grok-winapp-ai-direct-2a89` | on (enabledBy raydocs, 2026-10-01T00:33:37Z; this agent had enabled it earlier and did not re-enable after seeing it off) | present |
| [#874](https://github.com/raydocs/tono/pull/874) | `hunt/grok-winapp-heal-signout-2a89` | on (enabledBy raydocs, 2026-10-01T00:33:40Z; same) | absent; label API 403 |
| [#878](https://github.com/raydocs/tono/pull/878) | `hunt/grok-winapp-debounce-defer-2a89` | on (app/cursor, 2026-10-01T00:31:30Z) | present |
| [#879](https://github.com/raydocs/tono/pull/879) | `hunt/grok-winapp-down-uplink-2a89` | on (app/cursor, 2026-10-01T00:32:36Z) | present |
| [#884](https://github.com/raydocs/tono/pull/884) | `hunt/grok-winapp-connect-budget-2a89` | on (app/cursor, 2026-10-01T00:37:22Z) | present (the add-label call still returned 403) |
| [#900](https://github.com/raydocs/tono/pull/900) | `hunt/grok-winapp-wechat-paths-2a89` | on (app/cursor, 2026-10-01T00:42:10Z) | absent; label API 403 |

## Filed, not fixed

| ID | Area | Severity | File | One line | Issue |
|---|---|---|---|---|---|
| WIN-MONITOR-STALE-SNAPSHOT | A3 | P2 | `connection/monitor.rs` ~778 then ~856 | Kill-switch write uses a snapshot taken before DNS and a possible 18s TUN probe, with no `snapshot_generation` check. UI can show Locked while DIRECT reload is Blocked. WFP itself is unchanged | [#905](https://github.com/raydocs/tono/issues/905) |
| WIN-SWITCH-PROBE-ATTRIBUTION | A2 / A3 | P2 | `probes.rs` ~203 and ~237; `monitor.rs` `spawn_exit_identity_lookup` ~502; `state.rs` `record_exit_delay` | Same-generation hot switch stamps the in-flight delay and exit IP onto the newly selected node | [#906](https://github.com/raydocs/tono/issues/906) |
| WIN-DIRECT-RENEW-BLOCKED | A4 | decision | `connection/direct.rs` ~82–103 and `reconcile_direct_reload_failure` | Renewal failure calls `tono_restrict_bootstrap` and the monitor reconnects from Blocked. The "rolled back to full tunnel" log is wording; the proved mode is Blocked. Not changed. Selective AI hold stays with #738 | [#907](https://github.com/raydocs/tono/issues/907) |

## False positives

29 rejected. Each was checked against a guard, an existing issue, or a comment that states the behavior.

| Hypothesis | Why rejected |
|---|---|
| sing-box `build_runtime` sends AI direct or skips HY2 UDP | Product connect, Service, and installer do not call it. Call sites are the sing-box unit tests. |
| #797 already closes the signed-app process-path hole | #797 is suffix overlap in policy. The address-free `PROCESS-PATH-REGEX` + port rule is #871. |
| `Claude.exe` / Chrome is sent direct | Those process names hit MATCH or the assistant process pin to `Tono-Exit`. |
| AI DNS leaks on the normal path | Normal DNS is DoH via `Tono-Exit`, and port 53 is hijacked. A physical lookup is the DIRECT-classified case. |
| url-test moves off a dead exit | The selector is `select`, `store-selected` is false, and there is no url-test. Staying on the chosen node is intentional. |
| HY2 `skip-cert-verify` is accepted | `node.rs` rejects `skip-cert-verify: true` and requires a 32-byte pin. |
| Loopback DIRECT is wider than loopback | Only `127.0.0.0/8` and `::1`. |
| DoH resolvers missing from `protected_addresses` are a bypass | `policy.rs` still drops `1.1.1.1` and `8.8.8.8`. |
| `collect_ipv4_literals` turns DNS JSON into a bypass | Extra addresses become conjunctive rules. |
| Traffic policy is per-account | The document is global. |
| Hot switch leaves the old node IP excluded from the new session | The exclusion matters only when the new exit IP is already a DIRECT pin. The writer is held until the switch returns, so a widened old∪new permit does not stick. |
| Route ledger keeps a stale DIRECT/proxy class | Each sample is reclassified. Counters clear on ConnectOk and disconnect. |
| `ALWAYS_ADDRESS_FREE_WEB_SUFFIXES` includes assistant hosts | Those suffixes are China sites. `claude.ai` falls through to MATCH. |
| A late lock IPC after Disconnect re-blocks the user | Release and lock share `OWNER_LIFECYCLE_LOCK`. |
| DNS :53 preflight skipped when `active_runtime_resume` is Some | Intentional: a proven same-owner core already owns the port. |
| Same-session pre-arm backup dial is a cross-account leak | Intentional inside one session. The cross-account case is #874. |
| Duplicate release after `fail_connect` and a stale preflight | Already #798. |
| `register_selective_ai_block` fails open | The app never calls it. Exhausted protection full-releases until the #706 hook exists. |
| `set_stage` returns Ok when the generation matches but the FSM is not connecting | `begin_disconnect` follows `invalidate_connection`. |
| Health give-up, one failed probe, WeChat in-place skip | Already #715, #705, and #757 (merged: path changes now force a protected reconnect). |
| DNS status IPC failure is treated as fine | It counts as unprotected DNS, the same fail-closed as a missing kill switch. |
| Blocked during `direct_reload_until` is unhealthy | Blocked without a TUN permit is expected for that session's own reload (60s). |
| Disconnect deadlocks on `state.lock` across `start_explicit_release` | The worker waits. It is not the same task. |
| `protection_resync` clears a live barrier when `wanted == false` | That answer is used only when the armed record is already gone. |
| Fixed DNS id `0x544f` mixes two queries | Two queries, two UDP sockets. |
| Probe success accepts any HTTP 200-class | Exact HTTP 200 is deliberate. |
| Switch holds a lock across N connection DELETEs | Already #787. |
| `signed_wechat_path_regexes_govern_udp_media_and_not_tcp` misses the TCP path rules | The test looks for `PROCESS-PATH-REGEX` before `DST-PORT`. The emitter puts the port first on purpose. Deleting those rules would reopen the address-free hole. |

## Coverage

Hypotheses examined: 38. Verified and fixed: 6. Verified and filed, not fixed: 2. Recorded decision: 1. Rejected: 29.

A2, A3, A4, and A11 were read through area passes plus the call sites for the fixes above. Not every line of `connection.rs`, `direct.rs`, `config.rs`, `monitor.rs`, and `probes.rs` was re-read line by line after those passes. A6 was not opened.

In-flight items were not re-reported: #714, #715, #718, #741, #749, #757, #784, #786, #787, #791, #798.

Hunter: Grok 4.7

## Follow-up, 2026-10-01

The "Filed, not fixed" row for #907 is superseded. It is not an open decision. On failure Tono falls back to normal internet and keeps AI-service destinations blocked. Only an explicit strict kill switch may stay fully Blocked.

| Item | Result |
|---|---|
| [#907](https://github.com/raydocs/tono/issues/907) | Fixed by [#926](https://github.com/raydocs/tono/pull/926) (`hunt/grok-winapp-direct-renew-2a89`). Non-strict DIRECT renew failure leaves WFP unchanged and the App calls `tono_release_kill_switch_applying_narrow`. The watchdog does the same selective release for a lost committed DIRECT lease. Strict stays Blocked. The optional DIRECT commit log now says Blocked, which is what reconciliation does. Auto-merge was already enabled once (MERGE, app/cursor, 2026-10-01T00:56:00Z). This follow-up does not touch that flag. |
| [#905](https://github.com/raydocs/tono/issues/905) | Not fixed here. [#942](https://github.com/raydocs/tono/pull/942) is the other agent's fix. This agent's [#937](https://github.com/raydocs/tono/pull/937) was closed as a duplicate after auto-merge was turned off. |
| [#906](https://github.com/raydocs/tono/issues/906) | Not fixed here. [#945](https://github.com/raydocs/tono/pull/945) is the other agent's fix. This agent's [#944](https://github.com/raydocs/tono/pull/944) was closed as a duplicate after auto-merge was turned off. |

### A6

Read against `origin/main` `c2626f53`: `tono/commands/update.rs`, `tono/update_handoff.rs`, `tono/commands/quit.rs`, `feat/window.rs`, `lib.rs`, `tono/bootstrap.rs`, `tono/steps.rs`, `core/updater.rs`.

| Check | Verdict |
|---|---|
| Install `spawn` fails after Prepare has already narrowed WFP to bootstrap Blocked | Bug. Launching was persisted first, so the App treated the status as success and the machine stayed offline. Fixed by [#961](https://github.com/raydocs/tono/pull/961): spawn first; non-strict selective-release (`release_applying_narrow`); strict stays Blocked; the App error no longer says every failure retained protection. Auto-merge enabled once (MERGE, app/cursor, 2026-10-01T01:18:38Z). `needs-hardware` label call returned HTTP 403. |
| Prepare failure after Core stop | Already on main via #793 (`prepare_failure_releases`). Not changed. |
| Interactive Quit / Restart | `quit_release` must be proved. If it is not, the user can cancel or explicitly leave the barrier armed. Session-ending `RunEvent::Exit` abandons an unfinished release and leaves WFP armed; `lib.rs` states that. Not a new hole. |
| `clean_async` / `stop_core(true)` after that choice | Windows sessions store `supports_macos_kill_switch: false`, so this stop uses the legacy payload, which does not release. A successful release has already disarmed, and `transition_after_stop` returns when nothing is armed, so cleanup does not re-block. |
| `restore_dns_after_core_stop` | No-op on Windows. DNS restore is inside the Service release. |
| `tono/bootstrap.rs`, `tono/steps.rs` | No WFP, system proxy, or DNS writes. |
| `tono_prepare_update` | Not registered in `lib.rs`. No caller. The DNS-failure path that keeps WFP is not live. |
| `core/updater.rs` NSIS startup install | Does not quiesce WFP. A failed install continues the process with the protection it already had. |
| Service start sees `Launching` and the recorded executor process is gone | `reconcile_before_desired` rewinds that attempt to `Staged` and `restore_reconciled_desired_state` keeps the barrier on purpose ("retaining protection"). Not changed. A half-applied replacement is the reason this follow-up does not release there. |

`cargo test` was not run (rustc 1.83, workspace rust-version 1.98 / edition 2024).

Hunter: Grok 4.7
