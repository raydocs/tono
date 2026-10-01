# GLM-5.3 bug-hunt evaluation on raydocs/tono (read-only)

- Repo: public clone of `main` @ `ba7c8ae1` (2026-09-30 12:35 MDT). Open PR heads fetched as `refs/remotes/pr/N` so the diffs could be compared. Nothing was pushed, commented on, or modified on GitHub.
[credential/configuration details redacted]
- Spend: 21 calls, 417,561 input and 930,400 output tokens (897,620 of those were reasoning). About **$4.68**.
  - Each call used 30–60k output tokens, about 95% of them reasoning, and took 8–15 minutes.
  - The rate limit allows about 2–4 concurrent calls; 429s were retried.

## Step 1: blind calibration: 2/4

| Bug | Found? | Notes |
|---|---|---|
| #20 `last_attempt_at` not reset (control-plane `index.ts` ON CONFLICT enqueue paths ~1026/1055/1200/2095/2650) | **MISSED** | Made 4 other findings: 1 real minor, 1 plausible, 2 FP |
| #229 `try?` on `/helper/upgrade` → ~45 s stall (`HelperManager.swift:1167`) | **FOUND** (ranked #1) | 3 others: 1 minor real, 2 FP |
| #27 log stream not restarted on route change | **MISSED** | Judged `commitResidentialRouteAuditContext` correct. 3 others: 2 real (P2/trivial), 1 FP |
| #139 `VITE_OPS_ROLE` baked in at build time | **FOUND** (#3) | 5 others: 2 real (one is covered by open PR #716), 1 debatable, 2 FP |

Totals: 15 extra findings. About 6 real (mostly minor), 2 plausible or debatable, and 7 false positives, so ~47% of the extras were FP.

## Step 2/3: real scan (13 chunks, 41 findings)

- 12 were verified as new real bugs.
- 5 are real but already covered, fully or partly, by open PRs.
- 24 were rejected, so ~59% of the scan findings were FP.
- GLM's severity labels were usually inflated: many "P0" claims depended on code outside the chunk, or a guard somewhere else already covered them.

### Verified new bugs (ranked)

1. **P1: Windows startup cleanup of an unwanted intent never retries.** `apps/windows/service/src/core/windows_kill_switch.rs:2618-2631`
   - The code runs `remove_all_filters_unlocked().await?` and returns early on error.
   - service.rs:425/714 only logs the error, `ARMED` stays None, and the watchdog does nothing.
   - The WFP block-alls are PERSISTENT, so the machine stays blocked.
   - Status reports wanted=false/live=false, so the app thinks protection is absent and Disconnect is a no-op.
   - Trigger: a tombstone plus residual filters (emergency-disarm crash window, service replacement) combined with a transient WFP/BFE error at service start.
   - Fix: keep a pending-release flag that the watchdog retries, or report live=unknown so the app can issue a release.
   - Overlap: none. #733 and #740 don't touch this branch.
2. **P1: Windows DNS restore proof compares interface GUIDs case-sensitively.** `apps/windows/service/src/core/dns/mod.rs:1029-1046, 1074-1088, 1107-1120`
   - Merge and select use `eq_ignore_ascii_case`, and the comment at :858-863 admits the spelling drifts.
   - Trigger: the user's original DNS is a local resolver (127.0.0.1 / AdGuard / etc.) and the GUID case differs between snapshot and proof.
   - Result: the adapter isn't exempted, `live_loopback` = true, and disconnect/disarm is refused indefinitely, leaving the user stuck.
   - Fix: compare case-insensitively (normalize GUIDs once).
   - Overlap: none.
3. **P1/P2: macOS `consecutiveProtectionRepairCount` is never reset while audits stay healthy.** `apps/macos/Tono/App/AppState+Connect.swift:1532-1543`
   - It resets only at :702 (`resetReleasedSessionHistory`), 2057 and 2347.
   - Trigger: three unrelated repair events spread over hours of an always-on session.
   - Result: a terminal fail-closed pause (network blocked, auto-reconnect paused).
   - Fix: reset the counter after N healthy audits or a time window.
   - Overlap: **partial, #720**. It makes the pause fail open, but the counter still never resets.
4. **P2: macOS activation reconcile defaults to `protectionWasArmed: true`.** `AppState+Connect.swift:1926-1938`
   - `reconcileExternalProtectionState` calls `reconcileConfirmedExternalProtectionRelease()` with no arguments.
   - In the never-armed state the helper answers confirmed(false), which cancels the protected reconnect loop, and the user's connect intent is silently dropped.
   - Fix: pass `KillSwitchService.isArmed` / snapshot, as the loop at 2169-2227 does.
   - Overlap: none.
5. **P2: macOS core monitor counts TUN-missing ticks while a switch/reload is in flight.** `AppState+Connect.swift:1416-1446`
   - The counter increments before the in-flight guard and isn't reset in that branch.
   - Right after a switch, a single further missing tick triggers a spurious fail-closed teardown.
   - Fix: reset the counter in the in-flight branch.
   - Overlap: none.
6. **P2 (narrow trigger, P0-class impact): macOS RuntimeCleanup repair branch restores DNS only when `snapshotPresent`.** `apps/macos/Tono/Core/RuntimeCleanup.swift:376-416`
   - This contradicts the invariant stated at :362-369.
   - Trigger: a force-kill during the snapshot-removal window, and the helper is unavailable at the next launch.
   - Result: DNS is left on a dead 127.0.0.1.
   - Fix: restore/sweep loopback DNS regardless of snapshot presence.
   - Overlap: none.
7. **P2: macOS unarmed connect-failure cleanup overwrites core-stop and system-proxy errors.** `AppState+Connect.swift:1016-1027`
   - `transitionError` is overwritten, so a failed release is treated as clean and a system proxy can be left pointing at a dead core.
   - Fix: aggregate the errors.
   - Overlap: none.
8. **P2: macOS emergency disarm aborts, staying fail-closed, when a stale core survives SIGKILL.** `apps/macos/TonoHelper/main.swift` ~807
   - `let core = try CoreManager(...)` → `terminateOwnedCore` throws → "PF remains fail-closed".
   - The emergency path should release PF regardless (the daemon path does, via `secureFailedStartup`).
   - GLM's original PID-reuse framing is rejected. This is a reframed variant.
   - Overlap: #711/#712 keep `try CoreManager` → not fixed.
9. **P2 (niche): macOS helper crash-loops without DNS recovery when the bound user no longer exists.** `SocketServer.init` → `allowedGroup` (main.swift:1215) throws on getpwuid nil. `secureFailedStartup` releases PF, but `recoverDNSAfterStoppedCore` never runs.
   - Overlap: none.
10. **P2: Windows WeChat signed-path leg uses allow-in-place.** `apps/windows/app/src-tauri/src/tono/connection/monitor.rs:334-348`
    - With a healthy TUN the result is RecoveredInPlace, so newly signed paths are never applied and the leg retires.
    - Impact is misrouting only.
    - Overlap: none.
11. **P2: Windows `mark_verified` uses `ARMED.lock().unwrap()`.** `windows_kill_switch.rs:1246-1250`
    - This violates the poison-recovery invariant at :326-339: after any panic, the IPC handler panics instead of recovering.
    - Fix: use `armed_guard()`.
    - Overlap: none.
12. **P2 (low): Windows missing-snapshot and unrecorded-adapter checks only recognize 198.18.0.2.** `dns/mod.rs:679-709`
    - A legacy `::1`/fd00 protected-DNS residue is adopted as the user's "original" and exempted from proof.
    - Overlap: none.

### Real but covered by open PRs

- **macOS `ProtectedDNSManager` `.unresolved` owner sweeps loopback to Empty, then archives it as superseded, losing custom DNS.** `ProtectedDNSManager.swift:315-339`. Covered by **#712**.
- **macOS `status()` heals with a machine-wide PF flush after one failed read.** `KillSwitchManager.swift:671-690`. Covered by **#710**.
- **macOS reachability fingerprint ignores the IPv6-only uplink.** `PhysicalNetworkReachability.swift:117-141`. Covered by **#702**.
- **Windows: no fail-open on service crash/restart or reboot.** From s10 #1/#2.
  - Every connect arms persistent WFP block-alls (`wfp_model.rs:377-394, 475-484`), and there is no strict-mode concept today.
  - Service start restores a readable wanted intent as Blocked (`windows_kill_switch.rs` ~2560-2605).
  - This conflicts with the top rule. Covered by **#740** (release when the Core is unproven) and **#733** (corrupt state and unhealthy watchdog release).
  - Residual, not covered by any PR:
    - Only the block-alls are persistent. Loopback/DHCP/NDP permits are not (this contradicts the docstring at :248).
    - If the service fails to start at all after a reboot, the machine has no DHCP or loopback, and there is no way out short of an admin CLI. Suggest also persisting the infra permits (P2).

### Rejected GLM findings (one-line reasons)

- s01 #1 emergency-reset deadlock: `UpdateStorage.locked` uses non-blocking flock and aborts on SIGTERM.
- s01 #3 power-gate race: CoreManager and KillSwitchManager locks serialize start/stop and arm/secure.
- s01 #4 emergency disarm re-armed by GUI: the app's reconnect loop honors an external release.
- s02 #1 pf.conf reload failure keeps the block: `flushAnchor` removes the block rules first.
- s02 #2 IPv6 session endpoint: validation rejects IPv6 endpoints.
- s02 #3 rule file written before validation: needs a renderer bug to matter; negligible.
- s02 #4 `run()` output grace: negligible.
- s03 #1 supervisor re-block: the supervisor runs only while the core runs. The status variant is covered by #710.
- s03 #3 state >64 KiB: theoretical; the real DERP map is far smaller.
- s03 #4 `installEmergencyBlock` without a lock: no production callers.
- s04 #2 status by service name: no behavioral effect (`snapshotPresent` stays true).
- s05 #2 stale DNS service: the helper snapshot/handoff restores it.
- s06 #1 monitor stops on generation mismatch: switches/reloads don't bump the generation, and every bump site tears down or reconnects.
- s07 #1 `executeProtectedReconnect`: dead code.
- s07 #2 synchronous `CoreRuntimeManager.stop()`: no callers.
- s08 #2 replace endpoints without an owner check: the handler has `require_active_session` and the owner lifecycle guard.
- s09 #2 emergency disarm undone by the watchdog: the CLI refuses while the service answers (owner lock). The unhealthy reinstall also changes in #733.
- s09 #3 NRPT catch-all never swept by the Service: false. `ensure_restored` → `restore_protected` runs `restore_resolver_policy` (deletes NRPT) on every call, snapshotless path included (dns/mod.rs:2662-2671, engine.rs:1604).
- s11 #1 StartCore orphans a recovering watchdog: every production StartClash goes through `owner_proxy_transition`, whose `stop_previous_core` → `stop_core` calls `stop_watchdog()` unconditionally (server/mod.rs:130, manager.rs:740). The desired-state start runs only at service boot, when no watchdog exists.
- s11 #2 first netmon observation always counts as a change: the baseline is seeded with `topology::read()` at start (netmon.rs:206/251); it is None only when that read fails, and treating that as a change is the conservative choice.
- s11 #3 macOS `prepare_start` ignores preserve: the Rust service isn't the macOS privileged path (the Swift helper is), and the behavior is intentional.
- s12 #1 wanted=false/live=true: unreachable; `status()` returns live=false when ARMED is None.
- s12 #3 counter not reset: the Rebuild path allows in-place recovery; no user impact.
- s12 #4 browser DNS flap: the connect preflight re-checks.

## Verdict on GLM-5.3 as a bug hunter

- **Calibration: 2 of 4.** It caught the two "obvious-in-file" bugs (`try?` stall, build-time env) and missed the two that need cross-function state reasoning (upsert column not reset, stream restart on route change).
- **Scan yield:** about 1 verified new bug per 1.1 chunks. Most are P2; there are 2 solid P1s on Windows.
- **Noise:** FP rate of ~50–60%, and severities are inflated. It often labels P0 based on code it wasn't shown (it does say so, which helps triage).
- **Cost:** cheap per dollar (~$0.22/call). Slow: 8–15 minutes per call and a tight concurrency limit. It burns 95% of output on reasoning, so max_tokens must be at least 48–64k or the answer is truncated.
