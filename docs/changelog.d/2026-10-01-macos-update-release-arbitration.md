## 2026-10-01 · macOS pending-update release honors joined Restore and committed updates
- Scope: SHIP_PLAN §2 item 10 (fix); macOS app native-update release path (`AppState+NativeUpdate.swift`).
- Source: origin/main `0676435b`; branch `claude/fix-1132-1151-update-release`; Fixes #1132, #1151.
- Fix (#1132): an explicit Restore that joined a running automatic (AI-preserving) pending-update release was dropped, leaving the AI hold. The task now remembers the explicit intent and, after the automatic release settles, routes one plain release.
- Fix (#1151): Restore while a successor's Commit finished during the connect drain got "No pending update owns Disconnect" and left stale update gates. On that failure the app re-reads authenticated update status; only `pending=false` retires the local gates and runs the ordinary teardown with the same disposition. Unreadable status changes nothing.
- Added behavior: `disconnectAndWait(releaseKillSwitch: true)` waits for the follow-up task too.
- Tests: `NativeUpdateReleaseArbitrationTests` (one XCTest per issue). Not run locally (no Swift builds on this Mac); hosted CI runs them.
- Release: source only; no package, deployment, or publication.
- Limits: installed update/Restore timing on hardware not exercised; no helper change.
