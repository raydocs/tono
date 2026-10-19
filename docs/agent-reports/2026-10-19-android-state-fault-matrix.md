# Android tunnel-confirmation authority and state fault matrix (PR #1673)

Baseline `f769fc43b` (feat/android-singbox-horizon), WIP cloud-verification batch (exact tested SHA in cloud receipts). Scope: one
conservative, generation-fenced authority for "is Tono's tunnel up, and on which line/mode", shared
by the app, the ongoing notification, the Quick Settings tile and the widget. No visual changes.

## 1. Design

### 1.1 Identities (no wall clock is used for identity or order)

| Identity | Where | Meaning |
|---|---|---|
| `session` | `TonoVpnService.session` (random 8 bytes per service instance, `EngineStore.randomHex`) | Which engine instance wrote a snapshot, a status record or a notification. Compared for equality only. Not an account identifier. |
| `version` | `EngineSnapshot.version`, `PublicStatus.version` | Write counter inside one session; only grows (`update()` stamps `before.version + 1`). |
| `attempt` | `TunnelLedger.attempt` → `EngineSnapshot.attempt` | One connect, reload, disconnect or failure. Every start/end of an attempt bumps it. |
| `applied` | `EngineSnapshot.applied: AppliedTunnel(generation, node, mode)` | The confirmation: sing-box returned from `startOrReloadService` for `generation` **and** `BoxPlatform.tunsEstablished` advanced during that call (Android established a TUN) with the TUN still open. `node`/`mode` are what that start used (`SingBoxConfig.selectedNode(input)`), not the later selection. |
| `elapsedMs` | `PublicStatus.elapsedMs` (`SystemClock.elapsedRealtime`) | The only clock record age is measured on. `updatedAtMs` (wall) is kept for "Last known … at HH:mm" display only. |
| `boot` | `Settings.Global.BOOT_COUNT` | A live record from another boot is OFF; unknown boot (-1) falls back to the monotonic check. |

### 1.2 Single writer and the one rule

* `engine/TunnelAuthority.kt`
  * `TunnelAuthority.confirmed(s)`: `phase ∈ {CONNECTED, DEGRADED} && attempt > 0 && applied.generation == attempt`.
  * `TunnelAuthority.seal(s)`: drops an `applied` not for this attempt/phase; demotes an unconfirmed
    CONNECTED/DEGRADED to CONNECTING with no exit verdicts. Idempotent.
  * `EngineSnapshot.tunnelUp` now *is* `confirmed(this)`, so every existing `tunnelUp` consumer
    (engine guards, Home, Details lanes, notification text) became confirmation-based.
  * `TunnelLedger` (engine thread only): `begin` (new attempt, clears `applied` and probes first),
    `started` (confirm only with an established TUN; otherwise `end(FAILED, CORE_START)`; `null` for
    an earlier attempt), `probed` (only for the current, confirmed attempt), `rechecking`, `end`.
* `loadCatalog()` now returns `LoadedCatalog` without mutating the snapshot from the IO executor;
  connect/refresh commit the result on the engine executor. A delayed refresh is fenced by attempt;
  changing the catalog of a running tunnel first clears confirmation, then reloads. This service
  integration is source-inspected only (not compiled/executed yet).
* `TonoVpnService.update()` is the only writer: `seal(block(before)).copy(session, version+1)`; it
  writes nothing after `onDestroy` drained the engine thread (`retired`). connect → `begin(PREPARING)`;
  reload → `begin(CONNECTING)` *before* `startCore`; disconnect → `begin(DISCONNECTING)` then
  `end(IDLE|SIGNED_OUT)`; core failure / revoke / session end / sign-out → `end(...)`.
* Decode is conservative: `EngineSnapshot.fromJson` and `PublicStatus.fromJson` default missing
  `session/version/attempt/applied/confirmed/elapsedMs` to unconfirmed / unknown age, and the snapshot
  decode is sealed.
* Every reader projects through the same rule:
  * App: `TonoRoot` seals the snapshot once; Home/Details/Lines read `tunnelUp`,
    `TunnelAuthority.appliedNode/appliedMode`. Liveness evidence stays `EngineLink` (a live binder to
    the engine that holds the TUN fd; death → LOST at once). Late callbacks are fenced
    (`EngineClient.stale`: a snapshot of a session whose death this client heard, or a lower version of
    the same session, is dropped).
  * Notification: `TonoNotifications.ongoing` seals the snapshot; extras carry `PHASE` (sealed) and
    `SESSION`.
  * Tile/widget/alarm: `PublicStatus.of` writes the sealed phase, `confirmed`, `appliedLine`, `elapsedMs`;
    `SurfaceRules.view(record, nowElapsed, boot, tonoVpn, dead)` shows a tunnel only when: same boot,
    `0 ≤ age ≤ 30 s` on the monotonic clock, writer session not in the death log, `confirmed`, and
    Android lists **Tono's** VPN network (`tonoVpn == true`). Unknown (`null`) VPN reading is not proof.
* Selection vs applied: the radio in Lines is the selection; "In use" is drawn only on
  `appliedNode` (confirmed). The Exit pill's green "answered" dot needs the pill's line to be the
  applied one. The notification/widget show the applied line for an up tunnel and the selected line
  only while Connecting/Off (it is the line being started). Details lanes follow the applied mode
  when confirmed, else the selected mode with lanes not live.

### 1.3 Cross-process invalidations, fenced by session

| Invalidation | Writer | Fence |
|---|---|---|
| Watch hears the engine binder die | `EngineWatchService` (`:watch`) | Each `WATCH` registration carries the engine session (`EngineWatch.KEY_SESSION`); one `DeathRecipient` per registration captures it. `engineDied(session)` clears only the still-current registration, records the session in the death log, replaces only that session's notification claim (`ClaimRules.diedWith`), and starts `RepostGuard(session)`. A new instance in the same `:vpn` process re-registers (`EngineWatch.keep` compares `registered`). |
| Android re-posts the dead engine's notification on restart | `RepostGuard` (`:watch`), `engineStarting(session)` (new engine `onCreate`) | Guard replaces only the dead session's CONNECTED/DEGRADED claim, for 10 s on `uptimeMillis` (no record/wall-clock stop condition any more); `engineStarting` replaces any claim that is not the new instance's own (`ClaimRules.leftOver`). |
| App loses its binding | `EngineClient.onServiceDisconnected` (UI process) | Uses the session it last heard from that binding; records it dead, replaces only that session's claim. A never-heard engine (null session) records nothing. |
| Alarm backstop (`NotificationWatchdog.Receiver`) | `:watch` | `ClaimRules.supported`: the claim stands only on a fresh record **from the same session** that the projection supports; a claim from an instance that no longer writes is replaced. |
| "Status unknown" → "Tono stopped" follow-ups | watch / app | Only touch a replacement (no phase extra) titled "Status unknown", only when `tonoVpn == false`. |

Replacements only ever say less (Status unknown / Tono stopped); none writes the engine's status
record (the engine stays its single writer). The death log is a separate file, so a late death
cannot wipe a newer engine's confirmed record: the projection hides only records whose own session
is listed dead.

### 1.4 Persistence

* `StatusFile` (`tono/status.json`) and `DeathLog` (`tono/dead.json`) in no-backup storage:
  exclusive `FileChannel.lock` on a lock file (across processes) plus a JVM monitor (within one),
  a unique `File.createTempFile` per write, `fd.sync()`, checked `renameTo` (false is reported and
  the temp file removed). `StatusFile` refuses a write that would replace a newer record: same
  session → version must grow; another session of the same known boot → its monotonic time must
  not be earlier. `SystemSurfaces.publish` does not treat a refused/failed write as published.
* Freshness: the record's `elapsedMs` vs the reader's `elapsedRealtime` (a wall clock set back no
  longer makes a stale record fresh); boot mismatch → OFF; record from "the future" → UNKNOWN.
  Heartbeat due-ness (`SurfaceRules.needsWrite`) is on the monotonic clock too.
* Death invalidation: the death log (≤ 8 sessions, reset per boot) + Tono-VPN attribution.

### 1.5 Whose VPN

`VpnAttribution.tono(owners, myUid)`: true when a listed VPN's owner UID is this app's (API 30+
shows a VPN's owner only to its owner; all Tono processes share the UID); false when none listed
or every listed one belongs to another app; null when an owner is unknown (API 29, or query
failure). Only one VPN app runs per user, but another app's or another profile's VPN can be listed,
so "a VPN exists" is no longer treated as "Tono's tunnel exists".

## 2. Fault matrix → deterministic JVM regressions

Pure JUnit unless marked (R) = Robolectric. One `@Test` per behavior, clocks passed in, no sleeps.
Paths under `apps/android/mobile/src/test/kotlin/com/raydocs/tono/mobile/`.

| Fault | Mechanism | Test(s) |
|---|---|---|
| Engine crash while OS VPN temporarily lingers | death log + session-fenced projection; notification replaced at once, says unknown until Tono's VPN is gone | `surface/SurfaceRulesTest.anEngineCrashWhileAndroidStillListsItsVpnIsUnknownAtOnce`; (R) `surface/NotificationWatchdogTest.engineDeathReplacesItsClaimAtOnceAndSaysStoppedOnceTheVpnIsGone`; (R) `ui/EngineClientTest.engineDeathTurnsTheLastSnapshotUnconfirmedUntilTheRestartedEngineSpeaks` (existing, adapted) |
| Reload denied (consent revoked on reload) | `begin(CONNECTING)` clears confirmation before `startCore`; refusal → `end(NEEDS_PERMISSION)` | `engine/TunnelAuthorityTest.aReloadAndroidRefusesEndsWithoutAConfirmedTunnel`, `.aReloadClearsTheConfirmationBeforeTheCoreRestarts` |
| Start returns without a TUN | confirmation requires `tunsEstablished` to advance during the call | `engine/TunnelAuthorityTest.aStartWithoutAnEstablishedTunFailsInsteadOfConfirming` |
| Recovery/rollback failed (Android has none: failed reload closed the old tunnel) | `end(FAILED)`; record unconfirmed, no applied line, selection stays labelled selection | `engine/TunnelAuthorityTest.aFailedRecoveryNeverShowsTheRequestedLineAsCurrent`, `.heartbeatsAfterAFailedReloadCarryNoConfirmation` |
| App process death / resume with cached snapshot | callback epoch invalidated on pause/unbind/disconnect; in-memory only; fresh read on resume; stale queued callback of a dead session dropped; lower version of same session dropped | (R) `ui/EngineClientTest.returningToTheForegroundReadsTheCurrentSnapshotAtOnce` (existing), `.aSnapshotStillQueuedFromTheDeadEngineIsNotShownAsCurrent`, `.anOlderSnapshotOfTheSameEngineArrivingLateDoesNotReplaceANewerOne`, `.aCallbackRetainedAcrossPauseCannotReplaceTheFreshResumeSnapshot`; (R) `ui/HomeInteractionTest.lastWordFromALostEngineIsNotShownAsCurrent` (existing) |
| Doze-delayed observation (heartbeat or alarm held back) | monotonic freshness; alarm fenced by session | `surface/SurfaceRulesTest.aDozeDelayedHeartbeatIsUnknownUntilTheNextWriteLands`; `surface/ClaimRulesTest.aDozeDelayedAlarmLeavesTheNextEnginesConfirmedClaim`, `.aDozeDelayedAlarmReplacesAClaimWhoseHeartbeatStopped` |
| Reconnect with stale old death callbacks | per-registration recipient + session fence on every replacement | `surface/ClaimRulesTest.aStaleDeathCallbackCannotReplaceTheReconnectedEnginesConnected`, `.theRepostGuardOnlyReplacesTheDeadEnginesTunnelClaims`; (R) `surface/NotificationWatchdogTest.theOldEnginesLateDeathLeavesTheReconnectedEnginesConnected`, `.theWatchReplacesTheDeadInstancesRepostedTunnelClaimOnly`; (R) `ui/EngineClientTest.aLateDeathOfTheOldEngineLeavesTheNewEnginesNotificationAndRecord`; `surface/SurfaceRulesTest.theOldEnginesDeathDoesNotUnsetTheNewEnginesConnected` |
| Concurrent status writes / old invalidation | file lock + monitor, unique temp, checked rename, version/elapsed supersession | `surface/StatusFileTest.concurrentWritersLeaveTheNewestVersionOnDisk`, `.anOlderWriteFromTheSameEngineNeverReplacesANewerOne`, `.aWriteFromAnEarlierMomentOfAnotherEngineIsRefused`, `.aNewBootsEngineReplacesTheLastBootsRecord`, `.aFailedRenameIsReportedAndLeavesNoTemporaryFile`, `.aDeathNamesOneEngineInstanceAndOneBoot`, `.theDeathLogKeepsTheMostRecentInstances` |
| Unknown VPN / another app's VPN | `tonoVpn != true` is never proof of a tunnel | `surface/SurfaceRulesTest.anUnknownVpnReadingIsNotProof`, `.anotherAppsVpnIsNotTonosTunnel`, `.noTonoVpnNetworkMeansNoTunnelClaim`; `surface/ClaimRulesTest.aConnectedClaimOnAnUnknownVpnReadingIsNotSupported` |
| Requested vs applied node | `applied.node` from the start's config input; "In use" only on it | `engine/TunnelAuthorityTest.selectingALineWhileConnectedLeavesTheRunningLineAsTheAppliedOne`; (R) `ui/HomeInteractionTest.theSelectedLineIsNotMarkedInUseUntilTheTunnelRunsIt` |
| Requested vs applied mode | `applied.mode`; Details lanes follow it | `engine/TunnelAuthorityTest.aModeChangeIsAppliedOnlyOnceTheReloadedTunnelIsConfirmed` |
| Old probes after reload / late start result | ledger fences by attempt and confirmation | `engine/TunnelAuthorityTest.exitChecksFromAnEarlierAttemptAreIgnored`, `.aLateStartResultFromAnEarlierAttemptIsIgnored`, `.recheckingKeepsNoEarlierVerdictAsCurrent` |
| Default/legacy decode | missing fields → unconfirmed, unknown age; sealed | `engine/TunnelAuthorityTest.aSnapshotFromAnOlderEngineDecodesAsUnconfirmed`, `.snapshotJsonCarriesTheConfirmationIdentity`; `surface/SurfaceRulesTest.aLegacyRecordDecodesUnconfirmedAndOfUnknownAge`, `.aRecordClaimingConnectedWithoutTheEnginesConfirmationIsUnknown`, `.recordRoundTripsWithoutSecrets` |
| Unconfirmed tunnel claim on any surface | seal everywhere | `engine/TunnelAuthorityTest.aTunnelUpPhaseWithoutAConfirmationForItsAttemptIsSealedToConnecting`; (R) `ui/HomeInteractionTest.aConnectedSnapshotWithoutTheEnginesConfirmationIsShownAsConnecting`; (R) `surface/NotificationWatchdogTest.anUnconfirmedConnectedSnapshotPostsAConnectingClaim` |
| Wall clock moved / other boot | monotonic age, boot | `surface/SurfaceRulesTest.aWallClockSetBackDoesNotMakeAStaleRecordFresh`, `.aRecordFromAheadOfTheReadersClockIsNotFresh`, `.aTunnelFromBeforeARebootIsOff`, `.aHeartbeatIsDueOnTheMonotonicClockAndAChangeAtOnce` |
| Alarm vs leftover claim of a superseded instance | `ClaimRules.supported` requires same session | `surface/ClaimRulesTest.theAlarmReplacesAClaimFromAnEngineThatIsNoLongerTheWriter`, `.theAlarmLeavesAClaimItsOwnFreshConfirmedRecordSupports`; (R) `surface/NotificationWatchdogTest.theAlarmReplacesALeftoverClaimOfAnInstanceThatNoLongerWrites` |
| New engine starting over a re-posted claim | `ClaimRules.leftOver` | `surface/ClaimRulesTest.aStartingEngineReplacesEveryClaimButItsOwn`, `.aDeathOfAnEngineNeverHeardFromReplacesNothing`; (R) `surface/NotificationWatchdogTest.aStartingEngineReplacesTheDeadOnesRepostedClaimButNotItsOwn`, `.aLateStoppedConfirmationLeavesARestartedEnginesConnecting` |

Other kept/adapted tests: `SurfaceRulesTest.noRecordIsUnknownNotOff`, `.restingStatesDoNotGoStale`,
`.aConfirmedTunnelIsShownWhileItsHeartbeatIsFreshOnTheMonotonicClock`;
`TunnelAuthorityTest.aConfirmedStartWithAnsweringExitsIsConnected`;
`NotificationWatchdogTest.connectedWithoutTonosVpnNetworkIsReplacedWithStopped`, `.aLiveConfirmedTunnelIsLeftAlone`,
`.connectingFromAnEngineThatStoppedWritingIsReplacedOnceTheRecordIsStale`, `.engineDeathLeavesANormalStopAlone`.
Changed on purpose: the old `SurfaceRulesTest.androidMustAgreeAVpnExists` asserted that a null VPN
reading with a fresh record shows CONNECTED; the brief rules that out, so it is replaced by
`anUnknownVpnReadingIsNotProof` / `noTonoVpnNetworkMeansNoTunnelClaim`.

Counts: pure JUnit 46 (TunnelAuthorityTest 14, SurfaceRulesTest 16, StatusFileTest 7,
ClaimRulesTest 9); Robolectric 10 new (NotificationWatchdogTest rewritten to 11 tests, 4 of them new
behaviors; EngineClientTest +4; HomeInteractionTest +2).

## 3. Historical findings mapped

| Finding | Now | Regression |
|---|---|---|
| r8 GPT F1 / Opus §2: notification said Connected ~57 s with no VPN after a headless engine death | Watch replaces the dead session's claim at once; app/alarm do the same, fenced; tile/widget hide a dead session's record at once even if the VPN lingers. The r9 regression (watch re-post check replaced a restarted engine's Connected, run 39202302351) is addressed by session-fencing in the implementation; end-to-end recovery/timing is not yet verified. | `NotificationWatchdogTest.engineDeathReplacesItsClaimAtOnceAndSaysStoppedOnceTheVpnIsGone`, `.theOldEnginesLateDeathLeavesTheReconnectedEnginesConnected`, `ClaimRulesTest.theRepostGuardOnlyReplacesTheDeadEnginesTunnelClaims`, `SurfaceRulesTest.anEngineCrashWhileAndroidStillListsItsVpnIsUnknownAtOnce` |
| r8 cold process / Doze / widget gaps | Freshness on the monotonic clock; alarm/watch fenced so a delayed one cannot remove a newer claim; widget reads the same projection. JVM proves the decisions, **not** delivery timing. | `SurfaceRulesTest.aDozeDelayedHeartbeatIsUnknownUntilTheNextWriteLands`, `ClaimRulesTest.aDozeDelayedAlarmLeavesTheNextEnginesConfirmedClaim` |
| iOS retrospective: requested mode shown as current / rejected reload | Selection is never applied; reload clears confirmation first; refusal ends the attempt. | `TunnelAuthorityTest.aModeChangeIsAppliedOnlyOnceTheReloadedTunnelIsConfirmed`, `.aReloadAndroidRefusesEndsWithoutAConfirmedTunnel` |
| iOS retrospective: failed rollback with heartbeat still claiming | Android has no rollback; failure is terminal for the attempt and later heartbeats carry no confirmation. | `TunnelAuthorityTest.heartbeatsAfterAFailedReloadCarryNoConfirmation`, `.aFailedRecoveryNeverShowsTheRequestedLineAsCurrent` |
| iOS retrospective: unconfirmed current line | "In use" / applied line only from the confirmation. | `HomeInteractionTest.theSelectedLineIsNotMarkedInUseUntilTheTunnelRunsIt`, `TunnelAuthorityTest.selectingALineWhileConnectedLeavesTheRunningLineAsTheAppliedOne` |

## 4. Checks

**Parent integration update:** the real JUnit 4.13.2 runner executed all 46 pure tests successfully,
without product/JUnit stubs. The unknown-VPN regression was also run on old sources and failed its
assertion (not compilation). See [raw red/green and command](2026-10-19-android-state-jvm/README.md).
The following scratch checks are the earlier child receipt, not the acceptance evidence.

Ran (scratch dir under `/tmp`, nothing installed or downloaded; **not** the Gradle check):

* `git diff --check` → clean.
* Kotlin 2.3.20 compiler jar already in `~/.gradle/caches` (`K2JVMCompiler`, `-jvm-target 17`, against
  `~/Library/Android/sdk/platforms/android-36/android.jar`): routing sources + `engine/{TunnelAuthority,EngineSnapshot,TonoNotifications}.kt`
  + `surface/{PublicStatus,ClaimRules,NotificationWatchdog,EngineWatch,SystemSurfaces,SurfaceCopy}.kt`
  compiled with no diagnostics (scratch stubs only for `R`, `ui.Format`, `ui.shortReasonRes`,
  `TonoWidget`, `TonoTileService`).
* The 4 pure test classes compiled against a scratch JUnit stub (JUnit is not cached locally;
  stub implements `assertEquals/True/False/Null`, `@Test`, `@Rule`, `TemporaryFolder`) and run by a
  reflection runner: `passed=46 failed=0`.

Not run:

* `./gradlew --no-daemon :mobile:testDebugUnitTest :routing:testDebugUnitTest` (libbox.aar missing, Gradle 9.5.1 not cached).
* Any compile of `engine/TonoVpnService.kt`, `engine/BoxPlatform.kt` (libbox), `ui/EngineClient.kt` (AIDL), Compose UI files, or the Robolectric tests (NotificationWatchdogTest, EngineClientTest, HomeInteractionTest, UiFixtures) — reviewed by hand only.
* Initial child red check: not run. Parent subsequently ran the unknown-VPN test method verbatim against the old sources successfully compiling it; its assertion failed. Other behaviors still lack old-code red evidence.
* Device/emulator tests, real VPN, TalkBack, widget on a launcher.

## 5. Integration and device risks (unresolved)

1. **androidTest source integration completed by parent, not executed.** `DeviceFixtures.connected()`
   and `DeviceEvidenceTest.connected()` now explicitly carry fixture-only session/attempt/applied;
   the FIXTURE/no-tunnel labels remain. `SystemSurfacesDeviceTest` supplies confirmed/elapsed fields,
   uses the monotonic clock and asserts the first two cases are CONNECTED/DEGRADED (not all UNKNOWN).
   `LocalTunnelDeviceTest` uses `PublicStatusStore.current(context)` for production-equivalent sampling.
   AndroidTest compilation and execution now run on the owner-prepared Devin Linux KVM snapshot; local installation was cancelled.
2. **Reload must reopen the TUN.** Confirmation requires `openTun` during each
   `startOrReloadService`. sing-box libbox closes and recreates the service on reload (expected), but
   if a build reused the TUN, every reload would end FAILED/CORE_START (conservative, but a functional
   regression). Needs the device node-switch test.
3. **Owner UID attribution.** API 30+ relies on Android showing a VPN's owner UID to its own app;
   API 29 yields `null` → tile/widget/alarm say "Status unknown" while connected on Android 10
   (conservative). If an OEM redacts the owner for its own app, surfaces would never show Connected.
4. **Notification TOCTOU.** `NotificationManager` has no compare-and-set: a fenced replacement can
   still overwrite a newer engine's notification posted between the read and the `notify`; the
   result is a transient "Status unknown" (never a false Connected) until the engine's next
   update (≈1 s while connected). Not measurable on the JVM.
5. **Delivery timing is not proven by JVM tests.** Alarm inexactness/Doze, widget redraw, tile
   listening state and when Android re-posts a notification are OS behaviors; only the decisions are
   tested. If the engine, `:watch` and the app die together, nothing records the death; the record
   then goes UNKNOWN on staleness (≤ 30 s) or as soon as Tono's VPN is gone.
6. **Death log needs a heard session.** The app records a death only for a session it received a
   snapshot from on that binding; the watch only for a registered session.
7. Screenshot fixtures (`ScreenshotRender`, opt-in) now show "In use" only on confirmed snapshots;
   `LinesContent(base…)` with the idle fixture no longer marks a line in use.
