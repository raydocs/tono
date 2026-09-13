# Stage A2 independent lifecycle audit

Date: 2026-09-13
Repository: `raydocs/tono`
Baseline: `1d00b581dffdd98e84821c8789eb0c46b7a21bed` (local `main`, clean)
Scope: read-only source audit; no product changes, native networking, credentials, deployment, benchmarking, or sing-box build

## Executive result

The baseline has strong fail-closed connect/disconnect and DIRECT-policy ownership on both desktop clients. I found two new, actionable code-level issues:

1. **P2 / CONFIRMED:** a failed final PF/WFP convergence after a successful hot node switch can leave the old and new proxy endpoint permits installed while the product remains Connected. Windows explicitly restores the union on replacement failure; macOS pre-load failures leave its previously loaded union in place and are treated as ordinary switch errors rather than entering protected recovery.
2. **P2 / CONFIRMED:** Windows control-plane pin refresh holds the global `TonoState` mutex while awaiting the transport's write lock. An in-flight request holds the transport read lock for its entire HTTP attempt, so disconnect, switch, and generation invalidation can be delayed by the 45-second request budget.

Both are confirmed by complete source sequences at the pinned baseline. Linux cannot certify their PF/WFP or native-UI manifestation; the fault-injection cases below remain required on macOS and Windows.

## Baseline and method

Baseline checks:

```text
$ git status --short --branch
## main...origin/main
$ git rev-parse HEAD
1d00b581dffdd98e84821c8789eb0c46b7a21bed
$ git cat-file -t 1d00b581dffdd98e84821c8789eb0c46b7a21bed
commit
```

The independent auditor's checkout already matched the baseline; it did not substitute `origin/main`. The owning Stage A thread created the separate fixed experiment worktree described in `BASELINE.md`, imported this report, and checked both finding sequences, including the actual Swift product helper (not the Windows workspace's Rust macOS implementation). The auditor read `AGENTS.md`, `docs/architecture.md`, `docs/SHIP_PLAN.md`, `docs/RELEASE_LINES.md`, and the three 2026-09-13 readiness/telemetry/update reports, then followed the real lifecycle and diagnostics paths. Portable tests run by the owning thread are recorded in `RESULTS.md`; they do not reproduce the two findings or certify native protection.

## CONFIRMED findings

### A2-01 — Hot-switch endpoint convergence failure can retain old ∪ new permits while Connected

**Severity / impact:** P2 security-hardening and state-truth defect. On Windows, a narrow obsolete permit for the prior exit remains installed after traffic has switched to the newly proven exit. On macOS, failures before the helper loads the replacement child anchor leave the previously loaded transition union in the kernel; failures after the load have outcome-dependent PF state, but the app still keeps Connected without proving exact convergence. This is not a broad fail-open: the transition permits retain exact IP, port, and protocol restrictions. Windows further binds the Core application; macOS proxy rules match `user root`, not an executable identity (`KillSwitchPF.swift:135-143`). It nevertheless violates the selected-endpoint snapshot and least-privilege contract until a later successful arm/reconnect. On macOS, the controller can be on the new exit while local UI selection remains the old exit after the error.

**Gate mapping:** G1 (Connected must mean the active dataplane and exact protection state agree). It also weakens G2 diagnosis because Windows records dispatch but not completion. No G3 impact.

#### Windows complete trigger and ordering

Function: `connection::switch::switch_selected_node`

1. Snapshot previous/next nodes and routing: `apps/windows/app/src-tauri/src/tono/connection/switch.rs:131-160`.
2. Derive old, new, and `old ∪ new` exact endpoints: `switch.rs:165-170`.
3. Install the union: `switch.rs:176-196`.
4. Select the new Mihomo exit and pass a real TUN dataplane proof: `switch.rs:202-248`.
5. Close old-exit connections, then attempt the final new-only replacement: `switch.rs:250-251`.
6. If replacement fails, only log “leaving old∪new permits” and continue emitting the still-Connected status: `switch.rs:251-261`.

The Service proves what persists: `apps/windows/service/src/core/windows_kill_switch.rs:1154-1202` saves the immediately previous endpoint set and restores it on install failure. At step 6 that previous set is the union, not the pre-switch old-only set.

The continuous guard does not converge it. `apps/windows/app/src-tauri/src/tono/connection_health.rs:195-218` validates wanted/live/Locked/tunnel-permit, not equality with the selected proxy endpoint set. The status protocol exposes `endpoints` but only a digest for DIRECT endpoints (`apps/windows/service/src/core/structure.rs:415-441`); the monitor records only endpoint count (`connection/monitor.rs:614-687`).

#### macOS complete trigger and ordering

Function: `AppState.selectNode`

1. Capture previous and next exact endpoints and arm their union: `apps/macos/Tono/Services/AppState+Proxy.swift:87-99`.
2. Select the new Mihomo exit and pass the protected dataplane proof: `AppState+Proxy.swift:105-159`.
3. Close old-exit connections and attempt exact next-only PF convergence: `AppState+Proxy.swift:160-161`.
4. The selected-state success commit occurs only after convergence: `AppState+Proxy.swift:162-182`.
5. If step 3 throws, `isRecoveringProtectedConnection` is still false (it is set only for failed rollback at line 149), so the catch merely shows an error and leaves the session up: `AppState+Proxy.swift:193-218`.

The actual product-helper ownership path is:

`armSwitchKillSwitch` (`apps/macos/Tono/Services/AppState+Catalog.swift:621-631`) → `PrivilegedRuntimeCoordinator.armKillSwitch` (`apps/macos/Tono/Core/PrivilegedRuntimeCoordinator.swift:59-86`) → `KillSwitchService.arm` (`apps/macos/Tono/Services/KillSwitchService.swift:54-100`) → `HelperManager.armKillSwitch` and `POST /killswitch/arm` (`apps/macos/Tono/Core/HelperManager.swift:580-628`) → the Swift helper route (`tooling/scripts/core-helper/SocketServer.swift:166-173`) → `KillSwitchManager.arm` (`tooling/scripts/core-helper/KillSwitchManager.swift:109-310`). `tooling/scripts/build-core-helper.sh:13-24,62-71` confirms that `KillSwitchManager.swift` and `KillSwitchPF.swift` are compiled into the bundled product helper.

That helper does **not** implement the Rust helper's rollback. The prior union is already the live kernel ruleset after the first switch arm. For the final new-only arm, `KillSwitchManager.arm` writes/validates replacement rules, persists desired state and host mappings, and only then attempts the child-anchor load (`KillSwitchManager.swift:279-299`; `tooling/scripts/core-helper/KillSwitchPF.swift:6-22,343-405`). Therefore a directly evidenced failure before the load succeeds—for example atomic rule write/validation, state persistence, host mapping, or failure to execute the load—returns an error while the previously loaded union remains live. If the child load succeeds and a later state-disposal or verification step fails, source alone does not establish that the union persists; the exact PF outcome needs native inspection. In either case, the app catch at `AppState+Proxy.swift:193-218` does not withdraw Connected or establish which endpoint set is live. This node-switch branch differs from the **already-fixed** managed-DIRECT refresh branch, which explicitly disconnects into protected recovery when exact PF convergence fails (`AppState+Proxy.swift:479-575`).

**Why existing guards miss it:** generation checks cover supersession before/around selector mutation, and the dataplane proof correctly establishes that the new exit works. Neither establishes that the temporary endpoint union was subsequently narrowed. The final failure is explicitly accepted on Windows; the macOS recovery flag represents rollback failure, not post-success convergence failure. Neither monitor compares selected endpoint identity with the live proxy permit set.

**Direct evidence command:**

```bash
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:apps/windows/app/src-tauri/src/tono/connection/switch.rs | nl -ba | sed -n '124,262p'
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:apps/windows/service/src/core/windows_kill_switch.rs | nl -ba | sed -n '1154,1203p'
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:apps/macos/Tono/Services/AppState+Proxy.swift | nl -ba | sed -n '79,219p'
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:tooling/scripts/core-helper/KillSwitchManager.swift | nl -ba | sed -n '109,310p'
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:tooling/scripts/core-helper/KillSwitchPF.swift | nl -ba | sed -n '1,22p;339,405p'
```

**Minimal patch proposal (text only):** treat failure of the final exact endpoint arm as a protection-convergence failure, not switch completion. Preserve the requested node intent, stop/restrict under the existing serialized owner, enter Protected Offline, and run the existing protected reconnect; alternatively keep a bounded serialized convergence owner and do not retain Connected after its budget expires. Do not add a global mutex.

**One narrow real regression per native implementation:** inject failure only into the second endpoint replacement (union succeeds; selector and real dataplane proof succeed; new-only replacement fails). Assert Windows and macOS do not remain Connected with the union, the requested selection is retained for recovery, and the old endpoint is absent after recovery. The Windows test should use the Service fault seam and inspect endpoint protocol/IP/port; the macOS XCTest should use the helper/PF arm seam. Native packet/filter inspection is still required for gate evidence.

### A2-02 — Windows pin refresh holds product state across a transport write-lock await

**Severity / impact:** P2 responsiveness and cancellation ownership. A user Disconnect, server switch, or newer generation can wait behind unrelated control-plane HTTP I/O for up to the transport's 45-second total timeout. The tunnel remains protected, so this is not a fail-open; the defect is delayed user control and delayed stale-generation retirement.

**Gate mapping:** G1 (Disconnect and switch responsiveness/state truth). No direct G2 or G3 impact.

**Complete trigger and ordering:**

1. Any control-plane request enters `TonoTransport::send`, acquires `self.client.read()`, and holds it across the entire awaited HTTP attempt: `apps/windows/app/src-tauri/src/tono/transport.rs:455-458`.
2. The production client has 30-second connect and 45-second total timeouts: `transport.rs:31-33,226-236`.
3. A periodic pin refresh resolves protected DNS and persists pins, then acquires `TonoState` and awaits `refresh_control_plane_pins`: `connection/monitor.rs:318-357`.
4. `refresh_control_plane_pins` waits for `self.client.write()`: `transport.rs:168-172`.
5. While step 4 waits for the request's read guard, every operation needing `state.lock()` is blocked. Disconnect cannot execute its first generation invalidation (`connection/disconnect.rs:146-155`). Startup restore and service-hydration refresh repeat the same cross-await pattern at `commands/restore.rs:395-400` and `connection/monitor.rs:881-890`.

**Why existing guards miss it:** the periodic path verifies `connect_generation` before awaiting the transport write lock, but it retains the state guard during that wait. Cancellation cannot acquire state to advance the generation, and there is no timeout around the lock acquisition itself. The HTTP timeout bounds the stall but does not eliminate it.

**Direct evidence command:**

```bash
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:apps/windows/app/src-tauri/src/tono/connection/monitor.rs | nl -ba | sed -n '318,358p;881,890p'
git show 1d00b581dffdd98e84821c8789eb0c46b7a21bed:apps/windows/app/src-tauri/src/tono/transport.rs | nl -ba | sed -n '31,33p;168,172p;226,236p;455,458p'
```

**Minimal patch proposal (text only):** clone the API client/transport handle while holding `TonoState`, drop the state guard, then await pin refresh. In the periodic generation-sensitive path, reacquire state afterward and return false if the generation changed. Apply the same lock ordering to startup restore and service hydration. No new global lock is warranted.

**One narrow regression suggestion:** add a paused-time async unit test with a deliberately held transport read guard. Start pin refresh, then assert another task can acquire `TonoState` and advance the connection generation before the read guard is released; finally release it and assert the stale refresh does not publish ownership for the retired generation.

## NEEDS_NATIVE_VALIDATION

The code review cannot close these platform questions from Linux:

- Inject the A2-01 final-replacement failure on Windows 11 and macOS, inspect live WFP/PF rules, and prove no obsolete endpoint survives a Connected state.
- Exercise connect, cancel at each privileged stage, retry, switch TCP↔hy2, sleep/wake, Core crash, Service/helper restart, and explicit disconnect. Confirm DNS remains fail-closed until restoration is proven and Connected is published only after real system-TUN traffic succeeds.
- Verify VLESS permits are exact TCP IP+port and hy2 permits are exact UDP IP+port on the same catalog identity; the source derivation is correct (`apps/windows/app/src-tauri/src/tono/connection/endpoints.rs:6-17`), but Linux cannot certify WFP/PF rendering.
- Confirm native UI completion/error state after switch and delayed disconnect. A dispatched switch must not be interpreted as completed.
- G1 package/device acceptance remains open under `docs/SHIP_PLAN.md`. G2 still needs the documented carrier evidence and telemetry storage/readback evidence. G3 still requires installer-bound update handoff and native success/failure exercises tracked by open issue #26.

## HYPOTHESIS / not promoted to findings

- A compromised or malfunctioning privileged Core could reuse the obsolete A2-01 permit. That security consequence is plausible, but no exploit or native packet reproduction was performed; the confirmed defect is the stale exact permit and state mismatch.
- The A2-02 delay can approach 45 seconds only when pin refresh contends with a sufficiently slow in-flight pinned request. The lock ordering is confirmed; collision frequency and user-visible duration need instrumentation/native timing.
- No implicit cloud fallback was found in the active per-request home routing. Both runtime builders make the home group single-member (`apps/windows/crates/tono-core/src/config.rs:955-979`; `apps/macos/Tono/Core/Configuration/ConfigPipeline+Runtime.swift:617-639`). The macOS account bootstrap fallback in `AccountSession+Runtime.swift:143-165` belongs to feature-disabled legacy/optional Home-US runtime startup, not the signed per-request residential group; it is not reported as a product-route bug.

## ALREADY_FIXED at this baseline

These historical report items were checked and are not new findings:

- Windows server-selection UI now says the switch was **requested**, not completed (`apps/windows/app/src/pages/tono/servers.tsx:145-157`; regression `servers.test.tsx:207-218`). The backend command registers exactly one switch task under state lock and rejects a concurrent second switch (`commands/catalog.rs:228-280`).
- The Windows raw-log uploader now binds cursor records to account/consent scope and file identity, rechecks generation/scope before every segment and acknowledgement, and cancels an awaited upload on revoked scope (`apps/windows/app/src-tauri/src/tono/log_upload.rs:78-139,207-293`). The earlier telemetry reliability P1/P2 findings must not be repeated against this baseline.
- macOS raw-log upload has a separate consent switch, durable account scope, inode-aware cursor, bounded gzip segments, and account-switch abandonment (`apps/macos/Tono/Services/DiagnosticsLogOwnership.swift:3-75`; `DiagnosticsLogUploader.swift:6-138`; `Account/AccountSession+Telemetry.swift:57-108`).
- The unreadable/expired update evidence display fix described by `UPDATE_EVIDENCE_2026-09-13.md` is present. It does not close G3 or issue #26.
- macOS managed-DIRECT policy convergence already fails into protected recovery (`AppState+Proxy.swift:479-575`); A2-01 is the separate node-switch transaction.

## Positive protections verified in source

- **macOS connect:** captures node/policy inputs, arms PF before Core/TUN, carries the digest of the exact written runtime into helper start, proves owned TUN plus local/system protected DNS (and browser DNS where required), then requires real system-TUN dataplane evidence before `onCoreStarted` publishes Connected (`apps/macos/Tono/Services/AppState+Connect.swift:197-443,890-932`). `PrivilegedRuntimeCoordinator` serializes helper, PF, DNS, and Core mutations.
- **macOS teardown:** cancels and drains connect, switch, config-reload, and Core-monitor tasks before Core stop, DNS restore, and PF transition (`AppState+Connect.swift:684-875`). Managed-DIRECT reload owns the old∪new→new transition and fails protected after runtime commit.
- **Windows connect/cancel:** one 240-second transaction deadline and cancellation token wraps stages (`connection/transaction.rs:9-87`). Detached StartClash/DNS mutations reconcile late commits against generation/release intent (`connection/cleanup.rs:16-142`). Policy revision, digest, document, and physical interface are captured before Core start (`connection/stages.rs:93-198`).
- **Windows Connected truth:** controller readiness, WFP lock, protected fake-IP DNS, real post-lock TUN dataplane, and the Service verified latch all precede Connected (`connection/stages.rs:239-405`).
- **Windows DIRECT:** activation retains the policy read guard, rechecks the same revision/digest/document and selected node, and proves the Service endpoint digest before/after commit. Its short lease heartbeat/watchdog retracts expired or mismatched physical-interface permits to Blocked (`connection/direct.rs:562-628,1059-1382`; `apps/windows/service/src/core/windows_kill_switch.rs:1550-1927,2522-2644`).
- **Windows explicit release:** the detached serialized owner operation continues after the 55-second UI timeout; DNS restoration, Core stop, and WFP release remain ordered and failures retain protection (`connection/disconnect.rs:17-143`).
- **Endpoint and home identity:** VLESS/Hy2 endpoint protocol is derived explicitly and deduplicated by IP+port+protocol (`connection/endpoints.rs:6-53`). The residential group has one member on both clients, so home failure does not silently change egress to cloud.
- **Bounded/private diagnostics:** Windows user diagnostics is user-initiated, whitelist-built, secret/UUID/IP/path scrubbed, and free text is capped at 2,000 characters (`apps/windows/app/src-tauri/src/tono/diagnostics.rs:1-144,219-240`). Periodic Windows telemetry is consent-gated, kind-whitelisted, capped at 200 events/48 KiB, and does not block protection (`telemetry.rs:1-48,88-188`). macOS connection telemetry is a 128-event redacted ring with bounded fields and explicit consent-epoch draining (`ConnectionTelemetryBuffer.swift:3-99,146-177`). Local macOS audit values are capped at 4,096 characters.

## Unresolved observability

- Windows `AuditEvent::NodeSwitch` is emitted when the task is dispatched (`commands/catalog.rs:272-292`), with no corresponding switch-completed, rollback-completed, or endpoint-convergence-failed event. Treat `nodeSwitch` as intent only. The UI wording is now honest, but operator telemetry still cannot distinguish completion.
- Windows kill-switch status has the full proxy endpoint list but no canonical proxy-endpoint digest; diagnostics deliberately omit the list for privacy, and the monitor emits only its count. Therefore support cannot prove selected endpoint equality without privileged/native inspection.
- macOS records switch requested/succeeded/failed, but does not record a privacy-safe exact PF endpoint-set digest. A2-01's stale-union state therefore appears only as a generic switch failure.
- The source establishes bounded and scoped telemetry, not successful server storage/readback. The release report's G2 collection-window requirement remains external evidence, not a code conclusion.

## Release conclusion

Do not treat Stage A2 as a release certification. A2-01 should be fixed before claiming the G1 selected-endpoint/protection invariant. A2-02 should be fixed before native disconnect/switch acceptance so timing evidence measures the product rather than lock contention. G1–G3 remain governed by `docs/SHIP_PLAN.md`; no customer feed, tag, deployment, issue state, or Stage B action was performed.
