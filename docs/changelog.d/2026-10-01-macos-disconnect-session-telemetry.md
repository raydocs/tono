## 2026-10-01 · macOS reports disconnect telemetry for connected sessions
- Scope: SHIP_PLAN §2 item 10 (fix); macOS app diagnostics (`AppState+Connect.swift`).
- Source: origin/main `0676435b`; branch `claude/fix-1174-disconnect-telemetry`; Fixes #1174.
- Fix: a successful Connect cleared `connectionStartedAt`, which `disconnectOk` required, so no connected session reported duration and byte totals. A separate session start is set at the successful commit and consumed once at teardown; a duplicate Restore records nothing.
- Added behavior: none; Connect-stage timing keeps `connectionStartedAt`. Diagnostic only, not billing.
- Tests: `DisconnectSessionTelemetryTests` (one XCTest). Not run locally (no Swift builds on this Mac); hosted CI runs it.
- Release: source only; no package, deployment, or publication.
- Limits: none known beyond hosted-CI-only execution.
