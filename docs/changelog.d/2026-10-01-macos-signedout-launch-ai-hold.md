## 2026-10-01 · macOS signed-out launch keeps the automatic AI hold
- Scope: SHIP_PLAN §2 item 10 (fix); macOS app account restore (`AccountSession+Auth.swift`).
- Source: origin/main `0676435b`; branch `claude/fix-1117-signedout-ai-hold`; Fixes #1117.
- Fix: after a revoked session signed out automatically and the helper released broad PF while keeping the AI hold, a force-quit and relaunch sent the explicit disarm and removed that hold. The signed-out launch now skips the full disarm when an authenticated helper status proves no broad barrier is held, and restores DNS only.
- Added behavior: none. Unavailable/rejected status (older or unreachable helper) or a DNS restore failure keeps the full release, so a signed-out launch never stays blocked. Explicit sign-out and Restore are unchanged.
- Tests: `SignedOutLaunchReleaseTests` (one XCTest). Not run locally (no Swift builds on this Mac); hosted CI runs it.
- Release: source only; no package, deployment, or publication.
- Limits: installed revoked-session + force-quit relaunch not exercised on hardware; no helper change.
