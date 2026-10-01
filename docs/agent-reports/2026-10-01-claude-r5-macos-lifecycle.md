# Round 5: macOS install, update and account lifecycle (Claude Opus 5.5)

Base: `origin/main` `4bb0ba4a`. Source reading only. Nothing ran on this Mac that touches PF, DNS, routes, the helper or the network (owner rule). Helper Swift self-tests run only in hosted CI.

## Scope
- Helper install and upgrade: `HelperManager.installIfNeeded` / `installScript` (root guard, bound-account guard), `attemptSilentUpgrade` and the helper's `/helper/upgrade` (`SocketServer.stageAndUpgrade`, `helperUpgradeAdmissible`), the launchd plist, `TonoPeerAuthorizer`, `/core/start` config confinement (`CoreManager.validateConfigDirectory`, `ownedRuntimeConfigIsSafe`).
- Native update: `AppUpdater.check`, `NativeUpdatePreparation.run`, `installNativeUpdate`, `suspendForNativeUpdate`, `disconnectPendingNativeUpdate`, `retireDisconnectedNativeUpdate`, `RuntimeCleanup.cleanupStaleRuntime` (adopt or commit at relaunch), `terminateForNativeUpdate`.
- App removal and first launch after upgrade: `releaseIfTonoWasRemoved`, `tonoAppPresent`, `releaseRemovedInstallationLocked`, `emergencyRelease`, `runEmergencyResetLocked`, `RuntimeCleanup.recoverStaleRuntime` and `queryPendingNativeUpdate`.
- Account: `AccountSession` restore, sign-in, sign-out, `fail`, `enterEntitlementBlock` and the session verdict sink, `AccountLifecycleCoordinator`, `TonoAPIClient` credential generations, refresh, logout, `OfflineGrantGate`, `KeychainStore`, `ManagedExitCatalogOwnership`, `DiagnosticsLogOwnership`.

Skipped as instructed: #1071, #1255, #1269, #1287, #1239, #1238, and the recorded findings.

## Findings

| ID | Severity | Where (main 4bb0ba4a) | Verdict | PR / issue |
|---|---|---|---|---|
| MAC-REMOVAL-SELECTIVE-PENDING | P2 | `tooling/scripts/core-helper/main.swift:1645` `releaseRemovedInstallationLocked`; `KillSwitchManager.swift` `disarm` / `releaseWithAIHold` | Confirmed (source path). `disarm()` returns normally when removing the AI layer fails, and #1283 then keeps it `releasing` for start and the watchdog to retry. App-removal cleanup only checks the DNS and Core outcomes. On `.released` it deletes the helper, so nothing retries the removal, and the `/etc/resolver` sinkhole for first-party AI suffixes outlives Tono. Fixed: removal keeps the helper while the removal is pending (PF released, DNS restored). Helper 4.52.35 → 4.52.36. | #1302 (needs-hardware, no auto-merge) |
| R5-MAC-LOGOUT-KEYCHAIN | P3 | `apps/macos/Tono/Services/TonoAPIClient.swift:496` | Confirmed. `try? keychain.remove(.refreshToken)` swallows a failed delete. If the server revoke also failed, the next launch silently restores the signed-out account. | #1303 item 1 |
| R5-MAC-ACCOUNT-RESIDUE | P3 | `AccountSession+Telemetry.swift:580` `clearAccount` | Confirmed. The previous account's policy revision, failure messages and `lastConnectFailureAt` survive sign-out. These affect display and telemetry spacing only. | #1303 item 2 |
| R5-MAC-RESET-SELECTIVE | P3 | `tooling/scripts/core-helper/main.swift:1371` | Confirmed. The administrator `--emergency-reset` still removes the installation while the AI-layer removal is pending. Owner call. | #1303 item 3 |

## Checked, no new defect
- **Catalog or session crossing accounts.** Sign-out purges the catalog synchronously, before any suspension point, and binds the catalog to `.signedOut`. Sign-in adopts the new account before any transport can select an exit. A launch accepts the cached catalog only while the account is `.unknown`, and `connectRefusal` blocks Connect until Tono accepts the session (R612-O5). Credential generations stop an older refresh or logout from writing over a newer sign-in. The offline grant binds the refresh-token digest and the installed catalog digests. Diagnostics ownership is re-stamped per account. The traffic policy is fleet-wide (`/api/v1/traffic-policy` takes no user).
- **Revoked device while connected.** A refused renewal or request reaches `applySessionVerdict` → `enterEntitlementBlock`, which purges the exits and stops the Core. The 5-minute catalog sync plus `refreshAccount`, the 60 s offline verification and wake all keep asking. PF release after the Core stops is the helper watchdog (#1287). Whether the exit node drops the identity is control-plane and exit-agent work, outside this scope.
- **Helper socket privilege escalation.** The peer is checked by audit token (`LOCAL_PEERTOKEN`) plus a code requirement that refuses `get-task-allow`. The release entitlements are empty. `/core/start` accepts only the bound user's `Tono` or `Tono-Dev` config directory and snapshots the config into root. The allowlist forbids file paths, `output`, `rule_set`, `external_ui` and insecure TLS. `/helper/upgrade` accepts only the requesting bundle's own sealed helper and core, checks the Developer ID, and installs only a strictly newer version. The administrator install runs a codesign-verified guard under the update lock and refuses another account's binding.
- **Interrupted or failed update.** Staging is verified before suspend. A lost execute ACK is queried, never repeated. Relaunch adopts or commits through `reconcile`. A Protected Offline recovery observes the successor's fail-open launch (4.52.29). Quit with a pending update leaves PF and DNS to root. A failed prepare showing Blocked is #1255. An abandoned helper upgrade is #1071.
- **App removal.** The app refuses to run outside `/Applications`, so `tonoAppPresent` matches where the app can be. An unfinished update attempt blocks removal. DNS failure and a surviving Core already keep the helper (#1165, #1251).
- **First launch over an older helper.** A helper older than 4.5.0 has no ledger and is skipped. A rejecting daemon is reinstalled before any status is trusted. An unanswered helper names its launch state and repairs. The silent upgrade stops the Core first. A failed replacement releases PF through `disarm` (#1071 covers the AI hold).

## Open risks
- #1302 changes privileged removal behavior. The main session should run its independent Codex review before merge. Native removal with an injected resolver or route failure was not run (needs-hardware).
- The `--update-self-test` case in #1302 runs only in hosted macOS CI. The claim that it fails on old code comes from reading the code, not from a run.
- The existing removal tests call `releaseRemovedInstallationLocked` with the default pending reader, which reads the real `/Library/Application Support/Tono` record. That is fine on clean CI runners, but a developer Mac with a pending record would fail `removal-keeps-helper...` style checks locally.
- Commit trailer `Jev-Decision: claude-r5-macos-lifecycle-2026-10-01` was chosen by this worker because the brief named no id.
