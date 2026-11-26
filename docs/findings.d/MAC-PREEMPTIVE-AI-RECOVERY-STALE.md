# MAC-PREEMPTIVE-AI-RECOVERY-STALE

- **Severity**: P1 (misleading stale recovery banner) + P2 (duplicate DashboardView Restore button)
- **Found during**: Real-device verification of signed `0.0.87` (build 88) candidate on macOS 26 via `cua-driver`.
- **Root cause**:
  1. On a real Mac with `/var/run/tono-release.sock` installed (`HelperManager.releaseServiceInstalled == true`), `AppState.restoreInternet()` takes `restoreInternetPreemptively()` -> `finishPreemptiveRelease()`, bypassing the queued `disconnect()` path. `finishPreemptiveRelease()` updated `KillSwitchService.isArmed` and `RuntimeCleanup.clearCoreStarted()`, but never updated `selectiveAIRecoveryPending` from the `ai` component readback or `"restored"` outcome (and `onCoreStarted` did not clear it either). Existing XCTests (`QuitAIHoldTests`) ran without `/var/run/tono-release.sock` and therefore only exercised the legacy `disconnect()` fallback.
  2. `DashboardView.seaDashboard` unconditionally rendered `Button("Restore normal internet")` inside `selectiveAIRecoveryNotice` even when `seaAttentionActions`, `isConnecting`, `isDisconnecting`, or the primary action already rendered a Restore button directly below it. Its `zh-Hans` string also used `恢复互联网` instead of `恢复正常网络`.
- **Fix**:
  - Updated `AppState.finishPreemptiveRelease` to clear `selectiveAIRecoveryPending` when `ai` reads back `"restored"` or overall outcome is `"restored"`, keep/set it `true` when `ai` reads back `"residual"`, and preserve it on `"busy"`/`"superseded"`; cleared `selectiveAIRecoveryPending` in `onCoreStarted`.
  - Added `DashboardView.showsInlineSelectiveAIRecoveryButton(...)` to suppress the duplicate Restore button whenever another Restore action is visible, and aligned `zh-Hans` copy in `Localizable.xcstrings`.
- **Tests**: Added `PreemptiveReleaseSessionTests.testPreemptiveReleaseUpdatesSelectiveAIRecoveryPendingFromReadback` and `testSelectiveAIRecoveryInlineButtonOnlyShowsWhenNoOtherRestoreActionIsVisible`.
- **Non-bug confirmed**: Post-`--emergency-disarm` `RELEASE_UNFINISHED` on first Connect is the intentional `R-M2` invariant (`ReleaseWorker.swift:1223`, `ReleaseTests.swift:231`), preserved unchanged.
