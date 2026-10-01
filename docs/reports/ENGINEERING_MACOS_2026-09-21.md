# macOS engineering remediation — 2026-09-21

This is the macOS slice of the [owner's task](https://github.com/raydocs/tono/blob/8189417eebcc946e742da7c1f4d37e3dda004ee0/docs/ENGINEERING_QUALITY_ACCEPTANCE.md),
read at document commit [8189417eebcc946e742da7c1f4d37e3dda004ee0](https://github.com/raydocs/tono/commit/8189417eebcc946e742da7c1f4d37e3dda004ee0).
It supplies G1 connection/recovery, G2 failure evidence and G3 update evidence;
it does not close a customer release gate or replace the parent's combined report.

## Source, execution and ownership

- Repository: `raydocs/tono`. Model environment checked at start and delivery:
  `AMP_INITIAL_AGENT_MODE_KEY=gpt-6-astra-max`. No delegated subagents.
- Exact starting source: [26d798ce8e888d1bf42a12e1c0fcc23a5f7799c3](https://github.com/raydocs/tono/commit/26d798ce8e888d1bf42a12e1c0fcc23a5f7799c3),
  the published integration branch for [PR #267](https://github.com/raydocs/tono/pull/267),
  not local or remote `main`. This baseline includes the earlier remediation and
  recent macOS changes; historical Issue descriptions were not treated as fresh failures.
- Delivery branch: `fix/g1-macos-engineering-20260921`;
  [implementation PR #268](https://github.com/raydocs/tono/pull/268) was integrated
  by the parent into `fix/g1-engineering-acceptance-20260921`, not `main`.
  Fetched and verified that final behavior commit
  [cff1da327a2951a0ab04653da7dda64d8045a88d](https://github.com/raydocs/tono/commit/cff1da327a2951a0ab04653da7dda64d8045a88d)
  is an ancestor of combined source
  [5c3a1d2a8c58b052a016f8f73b0b730be7484070](https://github.com/raydocs/tono/commit/5c3a1d2a8c58b052a016f8f73b0b730be7484070).
  This report is a docs-only follow-up. Combined CI/adversarial review and all
  subsequent Windows work remain parent-owned; services remain sibling-owned.
- Work performed in a Linux Orb. Native execution uses the existing inspected
  [macOS CI](../../.github/workflows/macos-ci.yml): `macos-26`, with pinned
  sing-box input built on `ubuntu-24.04`. No local native build, new dependency,
  shared workflow edit, signing credential, deployment, release or update-feed operation.
- CI's unsigned app/ad-hoc helper artifacts are internal test inputs, not install
  qualification or evidence that a customer runs these bytes. The workflow uploads
  an app before XCTest; an artifact's existence is not test success.

## Confirmed defects and narrow corrections

| ID / gate | Failure mechanism and owner | Regression and correction |
|---|---|---|
| M1 / G1 | `AccountSession.releaseNetworkProtection` awaited AppState cleanup, then unconditionally restored DNS/disarmed PF itself. AppState's return can mean Core stop failed and protection was retained; the second owner overruled that refusal. | `testAccountReleaseCannotDisarmAfterDisconnectOwnerRetainsProtection` executes AccountSession → AppState → ConnectionCoordinator, substituting only system I/O. The injected callback is now required and is the sole release owner. A later successful explicit retry still disarms once. |
| M2 / G1 | DNS recovery used `(try? read(service)) ?? []`; unreadable loopback DNS looked clean, so recovery deleted the snapshot and authorized release. | `runRestoreReadFailureSelfTest` runs the production restore transaction with a failed disabled-adapter read. It must recover other services, preserve custom DNS, retain the snapshot/refuse release, then complete on retry. The sweep now retains read errors just like write/readback errors. |
| M3 / G2 | Audit flush restores the whole batch on write failure; continuing events grow the retry buffer without a bound. | `testFailedWritesRetainABoundedRecentTailAndReportLossAfterRecovery` uses the real serializer/writer with an unwritable destination, then repairs it. Retain the newest 256 entries/256 KiB at most; a successful retry emits a local-only loss notice without changing retained entries' account scopes. Count, UTF-8 bytes and recovery are checked. |
| M4 / G3 | The update journal hardcodes an obsolete Mihomo version on the sing-box baseline, labels `CFBundleVersion` as a source commit, and discards the known catalog revision. | `testUpdateSnapshotDoesNotInventRuntimeIdentityAndPreservesKnownCatalog` exercises the snapshot builder used by update preparation. Core version is now `unknown`; unavailable Core SHA/source commit stay empty; known catalog revision survives. The helper version field is the app's required contract, not observed binary identity. Journal schema is unchanged. |

The structural work is limited to controllable I/O boundaries and the update
snapshot construction. AppState still owns the release transaction; the helper
still owns the locked DNS transaction. Neither the tests nor AccountSession can
choose when that transaction is safe to release. DNS helper changes require the
existing install-contract version bump, `4.3.0` → `4.4.0`, and matching source hash;
no IPC field, peer authorization, credential or entitlement policy changed.
Preview fixtures explicitly supply a no-op release owner; no visual layout changed.

## Reviewed paths, existing checks and explicit limits

“Reviewed” below means the named production decisions/call relationships were
inspected, not that every statement in the containing tree was audited.

| Area / gate | Production paths and ownership checked | Evidence / remaining limit |
|---|---|---|
| Entry and presentation / G1 | `TonoApp`, AppState connect/disconnect, AppDelegate startup/termination. UI reflects staged work; Connected follows TUN verification rather than a successful controller query alone. | Source inspection; `ProtectedConnectivityTests`, `AppStateSupportTests`. No UI redesign, screenshot, responsiveness profile or installed-app run. |
| Cancel/late completion / G1 | `ConnectionCoordinator`: task identity, generations, queued connect, serialized disconnect and drain before privileged cleanup; AppState switch/config reload/monitoring call sites. | `testDisconnectDrainsCancelledMutationBeforeAnyReleaseStep`, `testDisconnectRequestsStaySerializedButOnlyLatestPublishesState`, `testExplicitReleaseInvalidatesQueuedConnectWithoutCancellingTeardown`, retired-switch finalization tests. Real IPC delay/OS scheduling combinations remain device work. |
| Sign-out/sign-in / G1 | Account lifecycle coordinator rejects work during cleanup, cancels and drains the existing work, and lets cleanup outlive cancelled waiters. AccountSession → AppState release ownership corrected in M1. API credential-generation contracts preserved. | `AccountLifecycleCoordinatorTests`; cancelled authentication, late token refresh/logout, late device/catalog/policy tests in `AccountSessionRequestTests`. Tests use isolated synthetic keychain entries; no customer account/credential or live service-side logout exercised. |
| Cached catalog/recovery / G1 | Logout synchronously purges `ManagedExitCatalogOwnership` before awaiting cleanup; the registered AppState discard callback clears managed nodes/revision/routing. Install and fallback paths check ownership/cancellation across awaits. | Earlier suspicion that the managed catalog simply survives sign-out was retracted after following the production callback. `ManagedExitCatalogOwnershipTests`, cancelled fallback test, `CatalogLiveSessionTests`. Preserve same-account offline cache/recovery; no extra authorization gate invented. |
| Privileged serialization / G1 | `PrivilegedRuntimeCoordinator` performs blocking helper operations off MainActor without internal await reentrancy. `SocketServer` handles authenticated requests serially; bounded HTTP framing/timeouts and peer checks remain. | Helper peer-authorization and request-contract tests. No protocol or permission change. Unsigned hosted inputs do not prove production signed IPC acceptance. |
| Core ownership / G1 | CoreRuntimeManager/helper CoreManager: root-owned staging, supplied digest verification, config validation, protected stop/start reload, PID/process validation, readback after failures, bounded diagnostic capture. | Helper `--core-lifecycle-self-test`, `--staging-self-test`, emitted Swift config checked by pinned Core/helper. These checks create no customer TUN and do not prove real traffic. |
| Lock ordering / G1 | App main actor → runtime actor → serial socket; Core lock → diagnostic lock; Core launch callback touches power/PF. PF arm checks the power gate; disarm holds power gate before PF, but request dispatch is serial. Power callbacks release the gate/PF lock before Core stop. | No concrete inversion found in the reviewed current callers. This relies on serial dispatch and does not authorize parallelizing helper requests. Native contention/stall fault injection was not performed. |
| PF and power / G1 | KillSwitchManager/KillSwitchPF commit, persisted intent, exact endpoint convergence, bootstrap restriction, emergency power barrier; HelperPower gate rejects late opening operations during sleep. | Existing PF parse/lifecycle tests use an unreferenced test anchor. No packets traverse it; sleep/wake, PF state-table withdrawal and crash packet-leak acceptance remain unexecuted. |
| DNS and crash recovery / G1 | ProtectedDNSManager root snapshot/per-service restore/readback/loopback sweep; RuntimeCleanup retains protection when recovery cannot be established; explicit-release helper repair remains authoritative. | M2 plus helper DNS self-tests and `CrashRecoveryFailClosedTests`. Injected DNS service I/O is not an actual System Configuration adapter failure. No live DNS mutation in M2. |
| Protected update / G3 | AppState preparation drains runtime work; runtime actor proves Core stopped/DNS restored/expected PF; UpdatePreparation journals before quiescence; Sparkle delegate vetoes failed preparation; recovery owns commit/removal. | `UpdatePreparationTests`, `UpdateHandoffJournalTests`. Checked pinned Sparkle 2.9.6 source: [installer driver](https://github.com/sparkle-project/Sparkle/blob/ac2def288cbff5cfc7df3ffef6abdf45b72bcb0a/Sparkle/SPUInstallerDriver.m#L514-L545) re-enters the veto before install after continuation. No signed installed-client upgrade executed. |
| Failure diagnostics / G2 | Stage/code/generation, elapsed timings, last Core errors, traffic-path classifications, bounded telemetry ring and account-owned acknowledgement. Written config digest is distinct from loaded digest; residential observation context is retired/restarted on runtime change. | Failure producer/classifier, telemetry ring and account upload tests. Cross-process request IDs and live binary/config attestation are not complete; a PID/version probe alone is not binary identity. |
| Audit privacy/retention / G2 | Local audit sanitizer, 0600 output, rotation, account `_uploadScope`, uploader immutable retries and consent invalidation; failed-write retention addressed by M3. | Audit path redaction, diagnostics ownership/boundary/retry/outcome tests. No new remote fields/consent. Actual slow-disk dispatch backlog and field-level end-to-end customer redaction were not exhaustively exercised. |
| Install/build inputs / G1/G3 | Helper version/hash install contract, installer confinement/repair, fixed Core SHA, Sparkle lockfile, unsigned CI boundaries and stage/test paths. | Existing policy tests include install recovery, signing boundaries, archive layout and appcast validation without publishing. No Developer ID/notarization, real uninstall or customer feed change. |
| Other macOS trees | Models/configuration reviewed where they feed the contracts above. SwiftUI/theme/assets, release notes and optional legacy Home-US sidecar internals were not a full feature/visual review. | Existing suite still builds/tests the app; optional Home-US is disabled in the production profile. This is not a complete macOS UX or third-party source audit. |

## Symptom → evidence map

| Symptom | Distinguishing evidence in the reviewed path | What is not established here |
|---|---|---|
| Cannot connect | Failure stage/code, physical-offline observation, helper refusal vs config validation, DNS readback, exit/controller/mixed/TUN probe results. | No inference that TLS EOF proves censorship, a bad UUID or a particular server cause. |
| Slow connect | Stage elapsed time, helper repair, controller readiness retry/sleep budget, catalog fetch, DNS and exit probe durations. | No customer latency measurement; request time contributes beyond controller sleep budget. |
| UI appears stuck | Coordinator task identity, disconnect stage and cancellation-drain state distinguish waiting for cleanup from a stale presentation. | Main-thread/disk profiles absent; helper fallback `networksetup` and SC preference locking lack a tested end-to-end stall deadline. |
| Connected but no traffic | Real TUN verification differs from controller/mixed-proxy reachability; selected exit, loaded digest and residential generation distinguish stale observations. | Hosted unit decisions are not actual TUN packets or per-customer runtime identity. |
| Switch breaks traffic | Generation fencing, old/new endpoint union, final PF convergence and recovery owner. | Real PF state withdrawal, transport availability and network changes require device/line data. |
| Disconnect leaves no internet | Core stop/readback, DNS transaction failure and PF retained/released state. M1/M2 reproduce false release paths at their production owners. | No attribution of historical customer incidents to these defects without matching device evidence. |

## Native evidence ledger

All commands below come from the existing workflow, not a local simulation.
The push-run checkout logs identify the tested commit explicitly. PR merge
checkouts are separate and are not silently called the branch head.

| Source / run | Commands and decisive result | Provenance / limits |
|---|---|---|
| Baseline [26d798ce](https://github.com/raydocs/tono/commit/26d798ce8e888d1bf42a12e1c0fcc23a5f7799c3), [push run 35656266214](https://github.com/raydocs/tono/actions/runs/35656266214) | Existing build, policy, privileged and pinned-input jobs succeeded; XCTest: 341 tests, one existing skip, zero failures. | Build checkout log prints the full source SHA. Baseline evidence only; does not exercise newly added regressions or prove final source. |
| First red [5fcd3037](https://github.com/raydocs/tono/commit/5fcd3037ad5e734d7ecf4c6fc46e9787db658393), [build job 106525614634](https://github.com/raydocs/tono/actions/runs/35657636957/job/106525614634) | `xcodebuild -project apps/macos/Tono.xcodeproj -scheme Tono -configuration Debug CODE_SIGNING_ALLOWED=NO ENABLE_USER_SCRIPT_SANDBOXING=NO test`: exit 65, 342 tests, one existing skip, three assertion failures in M1 only. Events were `stop-refused,dns-restored,restricted,dns-restored,disarmed`; retry also disarmed twice. | Checkout printed full `5fcd3037ad5e734d7ecf4c6fc46e9787db658393`. App/helper compiled successfully before behavior failed. Subsequent runtime-byte check skipped. |
| Same first red, [privileged job 106525614637](https://github.com/raydocs/tono/actions/runs/35657636957/job/106525614637) | `sudo apps/macos/Tono/Resources/tono-core-helper --lifecycle-self-test`: exit 1, `DNS restore read-failure regression FAILED: refused=false, snapshotRemoved=true`. | Same explicit checkout SHA. PF parse passed; downstream Core lifecycle/staging checks skipped by workflow dependency. |
| Diagnostic red [8812ec3d](https://github.com/raydocs/tono/commit/8812ec3d607c15572071123d8bb4a84f689e9da5), [build job 106531046330](https://github.com/raydocs/tono/actions/runs/35659309157/job/106531046330) | Same XCTest command: exit 65, 344 tests, one existing skip, eight assertion failures across M3/M4 only. Audit retained 512 entries / 1,052,530 bytes against 256 / 262,144 bounds; update snapshot emitted `v1.19.30-tono-gvisor-adaptive.1`, source commit `73`, catalog `nil`. M1 passed. | Checkout log prints full `8812ec3d607c15572071123d8bb4a84f689e9da5`. Real serialization/write recovery and production update snapshot failed; not compilation errors. Runtime-byte check skipped. |
| Same diagnostic red source, [privileged job 106531046259](https://github.com/raydocs/tono/actions/runs/35659309157/job/106531046259) | All helper steps succeeded: `--self-test`, `--lifecycle-self-test`, `--core-lifecycle-self-test`, `--staging-self-test`. M2 prints `DNS restore read-failure regression passed: failure retains snapshot; retry restores all services`. | First native green for M2; source checkout explicitly matches the diagnostic red source. Policy/input jobs also passed. Not evidence for later diagnostic changes. |
| Final behavior source [cff1da32](https://github.com/raydocs/tono/commit/cff1da327a2951a0ab04653da7dda64d8045a88d), [push run 35660304788](https://github.com/raydocs/tono/actions/runs/35660304788), [build job 106534122342](https://github.com/raydocs/tono/actions/runs/35660304788/job/106534122342) | Same XCTest command: exit 0, `Executed 344 tests, with 1 test skipped and 0 failures`, `TEST SUCCEEDED`. M1, M3 and M4 are individually named as passed. Unsigned Release build and Swift runtime-byte checks also passed. | Push metadata and actual checkout log both print full `cff1da327a2951a0ab04653da7dda64d8045a88d`. macOS 26.6.2 (25G83), arm64 image `20260907.0351.1`, Xcode 26.6 / SDK 26.5. Branch source, not a PR merge checkout or parent combined-source result. |
| Same final source, [privileged job 106534122322](https://github.com/raydocs/tono/actions/runs/35660304788/job/106534122322) | All four `sudo apps/macos/Tono/Resources/tono-core-helper` commands above passed. M2 again prints `DNS restore read-failure regression passed: failure retains snapshot; retry restores all services`. | Actual checkout prints the same full source SHA. Pinned-input job `106533711780` and policy job `106534122272` also succeeded; all four jobs completed successfully. No manual rerun/dispatch was added while parent combination CI was running. |

The final run's [internal artifact](https://github.com/raydocs/tono/actions/runs/35660304788/artifacts/10666547985)
is `tono-macos-beta-cff1da327a2951a0ab04653da7dda64d8045a88d`.
Upload metadata reports archive digest
`3bbffb5de1523ba47ca554023960499e234ff65410997ee0506c69a53c80bc6a`;
this identifies the uploaded archive, not an installed or running component.
The emitted fixture config passed pinned Core `check -c` and helper
`--runtime-contract-check`, with SHA256
`1ad5035b9f94d6d7ec249de0c50c8fc9dc2b35498cf0a41976f52bb8756817af`.
It is a test configuration, not a customer's loaded config identity.

CI evidence receipts recorded run/job results. The receipt tool could not extract
the large build log; direct `gh run view <run> --job <job> --log` reads supplied
the explicit checkout and named XCTest outcomes above. Neither step labels alone
nor a successful receipt establishes requirements completeness. The report-only
follow-up changes no production source, tests, dependency or workflow relative to
the final behavior SHA, so it carries this evidence forward rather than rerunning CI.

An intermediate test commit [e58904fd](https://github.com/raydocs/tono/commit/e58904fdb1b7543c7a172767ffb87060577caac9)
was superseded after a fixture attempted to set a read-only catalog projection.
The [push run](https://github.com/raydocs/tono/actions/runs/35659065870) was cancelled;
the [PR run](https://github.com/raydocs/tono/actions/runs/35659068829) failed at artifact
finalization with HTTP 403 before native tests. Neither is behavioral red evidence.
The corrected fixture seeds the actual writable revision; the genuine red is the
subsequent completed native run above.

The existing skipped XCTest is
`HelperInstallScriptTests.testEmitInstallScriptWhenRequested`: its opt-in
`TONO_EMIT_INSTALL_SCRIPT`/`TEST_RUNNER_TONO_EMIT_INSTALL_SCRIPT` destination is
unset. The skip was not added or broadened. No failing assertion was removed.
The helper build's unprivileged PF parse skip is followed by the passing root
`--self-test` step; it is not counted as PF evidence by itself. Compiler warnings
about actor-isolated `validateUpgradePath` and `backoffSeconds` calls appear in
both baseline and final logs; this is not a warning-free build claim.
Local `git diff --check` exited 0 for the release/DNS correction; it is a
whitespace check, not native verification.

## Remaining acceptance boundaries

1. Parent already integrated the behavior commits and owns combined CI and
   adversarial review. The separately green macOS branch does not accept that
   combined source. This report-only follow-up needs integration; no additional
   macOS workflow was dispatched to duplicate the parent's running checks.
2. Runtime diagnostics still cannot attest the actual running helper/Core binary
   digest, full source commit or loaded config independently of GUI bookkeeping.
   Update fields must not fabricate that missing evidence. Adding a durable
   cross-process identity contract needs parent coordination, not an invented value.
3. Root OS stalls (System Configuration locks and the `networksetup` fallback),
   real sleep/crash recovery, real adapter mutation, packet leak tests, authenticated
   installed-helper upgrade and signed Sparkle installation were not run. Hosted
   macOS tests and injected boundaries are preparation for, not substitutes for, those checks.
4. No device diagnostics were supplied; no assertion is made about an installed
   client's identity or the cause of a customer's historical failure. No claim
   is made that all bugs have been found or that G1–G4 are closed.

**Code/engineering acceptance:** M1–M4 have genuine hosted native red/green evidence
and the finite macOS coverage inventory is delivered. Whole-task acceptance still
requires the parent's combined-source checks and review; unverified mechanisms
above are not converted to passes by the green branch run.

**Ready for device acceptance:** the scoped macOS corrections can enter an internal
candidate after the parent's combined checks/review. No signed installed candidate
or live protection scenario has been qualified here; device and customer release
acceptance remain separate.
