# Grok macOS M13 hunt (2026-10-01)

Fixer: Grok 4.7. Area: diagnostics and telemetry in `apps/macos` — `CrashReporter.swift`, `DiagnosticsLogUploader.swift`, `DiagnosticsLogOwnership.swift`, `Diagnostics/*`, `LocalTrafficAudit*.swift`, `AppTrafficLedger.swift`, `ConnectionTelemetryBuffer.swift`, `AppRoutingResearch*.swift`, `AccountSession+Telemetry.swift`. Base at the start of the hunt: `origin/main` `7d525e6c`.

#725 (default-on snapshot upload, `AccountSession+Telemetry.swift`) was not modified.

## Fixed

| ID | Severity | File | What | Verdict |
|---|---|---|---|---|
| M13-G-F1 | P2 (ledger 低·已确认) | `DiagnosticsLogUploader.swift` `readSegment` (empty `eligible` passed to `gzip`) | A whole read chunk of another scope's complete lines is treated as a failed gzip. The cursor stays put, so this scope's later lines never upload. After five such reads a rotated backup is abandoned, including owned lines not yet reached. | Fixed in [#826](https://github.com/raydocs/tono/pull/826). Auto-merge on, merge commit. No `needs-hardware` (log cursor only; no route, TUN, PF, DNS, or kill switch). XCTest not run in this VM. |

No open issue matched. Nothing else verified was left unfixed, so no new issue was filed.

## False positives

| Hypothesis | Why rejected |
|---|---|
| `DiagnosticsLogOwnership` `saved!.id` crashes | The force unwrap is only on the true branch of `saved?.owner == owner`. |
| `AppRoutingResearch.componentIdentity` `values[0]` crashes | Guarded by `values.count == 2`. |
| Crash label rides in a snapshot field the Worker rejects, so a recovered crash fails the whole upload | The comment in `CrashReporter` is stale. The code sends `lastCrashLabel`, and `services/control-plane/src/index.ts` allowlists it. |
| `coreErrors` / `localizedDescription` leak secrets into telemetry | The failure notice is consent-gated, truncated (20 × 200), and the connect path documents why the core's last line is sent. No token or header is copied. |
| Network-log lines contain hosts, IPs, and process paths | That pipeline is the consented unredacted routing log (`DiagnosticsLogUploader` header). Research snapshots are a different gate. |
| Claude research uploads arbitrary hostnames | Official Claude/Anthropic names are the research subject. Every other destination is stored as `other` (`LocalTrafficAudit+Research.swift`). |
| Audit queue `sync`s the research queue and can deadlock connect | Research work does not `sync` back onto the audit queue or the main actor. |
| `AppTrafficLedger` `Int64` addition traps on the main actor | A single connection counter and the session sum stay far below `Int64.max`. |
| Two log rotations before a sweep drop the unsent tail | Documented cursor reset when the inode is gone (`pendingBackupSegment`). |
| `fsync` in the crash handler can hang a dying process | Intentional so the breadcrumb survives. The process is already fatal. |
| A failed JSON notice in `flushPending` drops the batch | The notice is a fixed dictionary of scalars. `JSONSerialization` does not fail on it. |
| Loading `upload-cursor.json` with `Data(contentsOf:)` can grow without bound | The file is written by this process as a few dozen bytes. A hostile local user who can replace it is outside the single-failure bar. |
| Empty Mihomo chains counted as direct traffic | Route classification, not a crash, a hang, or a secret. |
| `removeFirst` on the connection-dedup rings traps | The removed count is `prefix` of that same array. |
| `Task { await uploader.start() }` from the account session reads 4 MiB on the main thread | `start` / `sweep` run on the uploader actor, not the main actor. |

## Coverage

Read each listed file, then the callers that decide consent, scope, and what is uploaded (`AccountSession+Telemetry` upload/failure/research loops, `AppState+Connect` failure recording, the Worker `lastCrashLabel` allowlist). #725's diff was read so this hunt would not edit that switch or the outbox.

Hypotheses examined: 16. Verified and fixed: 1. Rejected: 15.

## Not finished

XCTest for `testOwnedLinesAfterAFullForeignChunkStillUpload` was not run here (no Xcode). macOS CI on #826 runs it. No second verified defect in this area met the bar for a patch or an issue.
