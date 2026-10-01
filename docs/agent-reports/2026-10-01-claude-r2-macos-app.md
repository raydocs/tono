# Round 2 bug hunt: macOS app side (Claude)

- Date: 2026-10-01
- Hunter: Claude Opus 5.5
- Base: origin/main `626b1d74`. Re-checked against `c57f00c0`; `apps/macos/Tono` did not change between the two.
- Scope: `apps/macos/Tono`, app side only (the helper is out of scope):
  - AppState and its extensions: connect, disconnect, reconnect, native update, launch protection
  - ConnectionCoordinator
  - catalog and traffic-policy apply
  - AccountSession: sign-in, sign-out, token refresh, entitlement block
  - the health monitor and auto-reconnect
  - system DNS and system proxy handling
- Rules: the TOP RULE and severity calibration from `codex-r4-prompt-RegLate.md`, plus decisions 030, 031, 033, 036 and 038 (`docs/decisions/`).
- Deduplicated against: `node tooling/scripts/records.mjs findings`, open issues, and the known items #1164, #1251, #1052, #1120, #901, #829 and #1071.

## Result

**No new P0 or P1 was found.** No new P2 or P3 needed a fix PR or an issue either.

| ID | Area | Severity | Location | Description | Verdict |
|---|---|---|---|---|---|
| (none new) | — | — | — | — | — |

Known items that showed up again during the hunt. They are not re-reported here.

| Known | Where it showed up | Note |
|---|---|---|
| #1071 | `Core/HelperManager.swift:259` | An abandoned helper upgrade does a full `KillSwitchService.disarm()` in the `defer`, with no AI hold. |
| #1057 (R3CONN-DEC01) | `AppState+Connect.swift:2538`, `:2565` | The DNS failure pause and the supplemental-conflict hold keep a preserve teardown ("Protected Offline"). The helper core-down watchdog bounds the cut to about 30 s, then releases with the AI hold. |
| #1052 | explicit-release paths | Unchanged. |

## Paths verified (bounded, no new defect)

| # | Hypothesis | Why it is not a new P0/P1 |
|---|---|---|
| 1 | A preserve teardown (`disconnect(releaseKillSwitch:false)`) leaves the network cut in non-strict mode. | Every preserve teardown stops Core. The helper core-down watchdog (`SocketServer.observeCoreForWatchdog`, `:344`) disarms after 3 checks (about 30 s) with `preserveAIHold`. A bootstrap left by a dead app is released by `observeOrphanedBootstrap` (`:393`). The cut is bounded and the AI block stays. |
| 2 | Entitlement refusal or `fail()` cuts the network. | `enterEntitlementBlock` (`Account/AccountSession+Auth.swift:688`) calls `descriptorConsumer(nil)`. That becomes `acceptTonoTransport(nil)` (`AppState.swift:921`), which does a preserve teardown, so this is the same bounded path as #1. Periodic telemetry and research upload enter the block only on a final 401, after the client's own token renewal was refused. |
| 3 | An automatic failure does a full disarm and drops the AI hold. | Every automatic `disconnect(releaseKillSwitch:true)` passes `automaticFailureRelease: true`. Checked at `AppState.swift:2102`, `AppState+Catalog.swift:365`/`:391`, `AppState+Proxy.swift:702`, `AppState+Connect.swift:1662`/`:2284` and `AppState+NativeUpdate.swift:138` (automatic only when no explicit Restore joined). The only full releases are user actions (Restore internet, Quit, Sign Out) and the known #1052 and #1071. |
| 4 | Optional direct-policy apply failure (`AppState.swift:1940`) leaves PF in a mixed state. | Before `/core/sync`, it re-arms the previous exceptions and keeps the session. After `/core/sync`, it calls `ExhaustedFailureNetwork.afterFailure(strictKillSwitchExplicit:false)`, which returns `.failOpen` and does an automatic release with the AI hold. On macOS the `.selectiveFailOpen` branch cannot be reached, because `selectiveAiBlockReady` is passed as `false`. |
| 5 | A queued optional-policy reload is lost behind a node switch or reload. | `pendingOptionalPolicyReload` is drained by `startPendingConfigReloadIfPossible` (`AppState+Proxy.swift:782`), both from `finishConfigReloadRequest` and when a node switch ends (`:90`). The early return for an empty policy recurses so a queued full rewrite still drains. |
| 6 | A policy accepted mid-connect is never applied. | `installManagedTrafficPolicy` stores the policy. `onCoreStarted` then calls `scheduleBackgroundOptionalPolicy()` (`AppState+Connect.swift:1186`), which reads the newest `managedTrafficPolicy`. |
| 7 | The health monitor parks forever with the tunnel dead. | `classifyPostLock` yields only `tunRouteUnavailable`, `coreExitUnreachable` or `networkEnvironmentOffline`. The first two reach `applyExhaustedArmedFailure` after the re-arm and escalation ladder (`AppState+Connect.swift:1947`). The third is reported only when every physical link (Wi-Fi, Ethernet, cellular) is unsatisfied, and then there is no network to fall back to. |
| 8 | A `.moved` network change or a failed node switch strands the user. | `.moved` does a preserve teardown, then `scheduleProtectedReconnect`. When the reconnect is exhausted it goes through `applyExhaustedArmedFailure`, which releases with the AI hold. A failed user switch (`recoverFailedNodeSwitch`, `AppState+Proxy.swift:251`) does a preserve teardown and a reconnect. A catalog removal releases with the AI hold. |
| 9 | The system proxy is left pointing at a dead port. | In managed mode, connect forces `tunEnabled = true` (`AppState+Connect.swift:114`), and `applySettingChange` refuses to turn TUN off. So `enableSystemProxy` is never reached. Every teardown calls `disableSystemProxyIfNeeded`. |
| 10 | Quit with an unreachable helper (`App/AppDelegate.swift:324`) cuts the network. | Quit returns without releasing PF. Core is still supervised by the helper and the tunnel keeps carrying traffic. If Core dies, the watchdog in #1 applies. This is a deliberate choice: an unreachable helper is not evidence that no update owns protection. |
| 11 | Native update `prepare` fails after `suspendForNativeUpdate`. | Monitors are cancelled and the app shows Blocked (`isProtectionBlocked`). Core is either still up and carrying traffic, or the helper stopped it and the watchdog releases. Recovery is a single user Connect or Restore. This is UI/P3 at most, and it overlaps the #1220 hunt area. Not filed. |
| 12 | `AccountLifecycleCoordinator.run` drops a submit during cleanup. | A sign-in submitted while a sign-out or release cleanup is in flight is ignored (`Account/AccountLifecycleCoordinator.swift:17`). The user retries once the cleanup is done. P3 UX, no network effect. Not filed. |
| 13 | `KillSwitchService.disarm` throws when the helper does not answer. | This needs two independent failures (the helper is dead and a release is due). That is P2 at most by calibration, and the helper's launchd keep-alive owns it. Not filed. |
| 14 | Concurrent token refresh breaks sign-in. | `TonoAPIClient` coalesces renewals through one `refreshTask`. An `unpersistedRefreshToken` is kept until persistence succeeds. The 401 retry happens once per request. No path found that signs out on a transient error. |

## Not covered

- `Core/RuntimeCleanup.swift` was only partly read: the stale-runtime cleanup that #795 made injectable.
- `AppState+Persistence.swift`, `AppState+Subscriptions.swift` and `AppState+RouteChoices.swift` were not read in full.
- Nothing here was run. Per BRIEF, this was code reading only on the MacBook: no XCTest, no helper self-test, no hardware.

## Hypothesis count

14 examined, 0 new defects, 3 known (#1071, #1057, #1052).
