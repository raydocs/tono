# Tono Unified Core & Reliability Release

Internal development report for macOS **0.0.68** + Windows **0.0.35**.
GitHub test publish of macOS 0.0.68 / Windows 0.0.35 is authorized.
Do not advance Sparkle, `windows-updates`, R2 customer download, or the
release-center Worker until the operator confirms the test packages.

## Status

In-tree implementation of the unified protected-connection contract,
update journal, telemetry buffer, connect-path slimming, and node-switch
rollback. Remaining work: full Clash Verge crate extraction, real-device
E2E, packet-capture leak proof, and installer packaging.

## 1. Root cause confirmed

macOS `AppState.connect` treated controller `/delay` as a hard gate.
A 504 on `https://www.gstatic.com/generate_204` threw:

`The selected Reality server did not pass its protected health check.`

The parallel system TUN probe was ignored. Both probes also targeted
Google only, so one provider failure failed the session.

Windows already used advisory `/delay` + three-origin TUN racing.

## 2. Connection decision table

| Controller `/delay` | Real TUN (any of 3 TLS origins) | Mixed proxy | Verdict |
| --- | --- | --- | --- |
| fail | success | n/a | **Connected**, `controllerExitAdvisory` |
| success | fail | success | **Not connected**, `TUN_ROUTE_UNAVAILABLE` |
| fail | fail | success | **Not connected**, `TUN_ROUTE_UNAVAILABLE` (node/core may be fine) |
| fail | fail | fail | `CORE_EXIT_UNREACHABLE` or `NETWORK_ENVIRONMENT_OFFLINE` |
| n/a | one origin fail, another success | n/a | **Connected** |

Order of proof: Kill Switch wanted/live/locked → core/controller ready →
TUN exists → protected DNS → real App HTTPS → controller delay advisory.

Origins (fresh client, system DNS, no explicit proxy, after PF/WFP lock):

- Google `https://www.gstatic.com/generate_204` → 204
- Cloudflare `https://cp.cloudflare.com/generate_204` → 204
- Apple `https://www.apple.com/library/test/success.html` → 200

Two in-place rounds, 500–1000 ms jitter, core and PF stay live.

## 3. Update journal states

`idle → updatePrepared → connectionQuiescing → cleanShutdownCompleted →
protectedHandoffRecorded → installStarted → firstLaunchMigration →
protectionResuming → verified → committed`

`failed` is terminal for that attempt. Timeout during cleanup writes
`protectedHandoffRecorded` and exits fail-closed.

## 4. Node switch

Selector + temporary exact PF/WFP permit → fast TUN verify → commit.
On failure: restore previous selector and re-verify. Core restart rate
target remains 0%. Session mixed/controller ports are allocated per
connect (no fixed 7890/9090).

## 5. Clash Verge leftover

Renamed Windows app crate `clash-verge` → `tono-windows` and bumped to
0.0.35. Workspace crates, sidecar, IPC, and macOS service identity now
use Tono names. `verge-mihomo` remains only for leftover process sweep
and dual-read of previous PF/GID/launchd identities.

Allowed remaining hits: migration, THIRD_PARTY_NOTICES, LICENSE,
historical tests.

## 6. Third-party engine retained

Mihomo / gVisor stays as the fixed, patched, reproducible TUN engine
baseline `v1.19.29-tono-gvisor-adaptive.1`. No rewrite of VLESS, Reality,
TLS, DNS, or gVisor.

## 7. Known limits

- Real-device update E2E (0.0.67→0.0.68, 0.0.34→0.0.35) not run.
- PF/WFP packet-capture leak proof not yet attached.
- Performance p50/p95 numbers need a measured baseline run.
- Clash Verge crate extraction is not finished.
- Formal installer payloads have not been built or signed.
