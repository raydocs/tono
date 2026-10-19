# iOS round 12 — raw local receipts (Linux)

Answering round 11's reviews: the mutation-red and stub-typecheck claims had only filtered excerpts,
so they could not be checked. These are complete, unfiltered outputs of scripts kept beside them,
run on commit `abc03885ad4118b6a7b3dbf01dda31bfdc1d031f` (clean `apps/ios` tree) on the Linux orb.
Re-run from a checkout of that commit: `mutation-red.sh <dir>` and `stub-typecheck.sh <dir>`.
`SHA256SUMS` covers the logs, the scripts and the stubs.

| Log | What ran | Result |
|---|---|---|
| `logs/swift-test-baseline.log` | `swift test` in `apps/ios/TonoKit`, unmutated | 74 tests, 0 failures, exit 0 |
| `logs/M1…M7-*.log` | one mutation each (the unified diff is at the top of each log), then `swift test --filter <suite>` | each exit 1; the failing assertions are in the log |
| `logs/packet-tunnel.log` | typecheck of the packet tunnel + shared files against TonoKit (own module) and `stubs/` | 0 errors, exit 0 |
| `logs/app-model-services.log` | typecheck of `App/Model`, the tunnel/storage services, `Status/` against TonoKit and `stubs/` | 0 errors, exit 0 |
| `logs/packet-tunnel-negative-control.log` | the same tunnel check with one call renamed to a member that does not exist | 1 error, exit 1 (the check can fail) |

Mutations: M1 heartbeat ignores whether a graph runs; M2 no reply assumed to be the previous graph;
M3 put-back error swallowed; M4 refused inputs left in the file; M5 status write without the lock;
M6 the app's write always wins; M7 an unfinished put-back dropped when the next save fails.
M1–M4 repeat round 10/11's reds on this code; M5–M7 are new.

What these do not show: the stubs stand in for Libbox, NetworkExtension and UIKit/SwiftUI, and
`TunnelCommandError` (its file is wholly `#if canImport(AppIntents)`), so a typecheck here is not an
Xcode build; Views are not typechecked here. Xcode builds, the simulator UI tests and screenshots
come only from hosted `macos-26` iOS CI. The status-file tests use a real file, two threads with
their own descriptors and a python3 process holding `flock`; they are not the app and the packet
tunnel as two iOS processes, and nothing here ran on a device.
