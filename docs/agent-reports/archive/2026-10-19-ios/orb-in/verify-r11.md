Verification, round 11 baseline: code `c2f8762977360d8f2c953bf787651b8c5ad825df` (branch tip `f63a947` adds only the changelog fragment).

**Red check:**
- TonoKit mutations back to round-10 behaviour, run on Linux (`swift test`):
  - heartbeat ignoring whether a graph runs → `TunnelGraphTests.testRebuildAndRestoreBothRefusedMakeTheHeartbeatSayRoutesStoppedNotConnected` gets `StatusWording(titleKey: "state_connected", switchOn: true, action: .disconnect)` instead of routes stopped / off / retry;
  - NO_REPLY assuming the previous graph → `testNoReplyAndNoStatusIsUnconfirmedNotThePreviousModeInEffect` fails twice (`notApplied(NO_REPLY, threeTier)` ≠ `unconfirmed(stable)`; the file holds threeTier, not stable);
  - put-back via `try?` → `testAFailedPutBackOfTheFileIsReportedNotSwallowed` (`unsaved` nil ≠ threeTier);
  - the extension not putting the file back → the chain test's file is still the refused `stable` inputs.
- The UI tests' red is the CI runs below, each failing on a real finding:
  - [39167318732](https://github.com/raydocs/tono/actions/runs/39167318732): Details' Settings row 1.2:1, and the sheet grabber at 76×25;
  - [39171778053](https://github.com/raydocs/tono/actions/runs/39171778053): the sweep flagged Settings Close at 32×36, a bare switch and the grabber;
  - [39175793888](https://github.com/raydocs/tono/actions/runs/39175793888): Close at 48×36.
- The new UI behaviour tests (unconfirmed, put-back, pending, routes-stopped widget) were not run against the old code; that is a source-level red only.

**Ran:**
- iOS CI [39184374749](https://github.com/raydocs/tono/actions/runs/39184374749) @ `c2f8762`, success:
  - 31/31 XCUITests, 0 skipped;
  - AX5 sweep: 172 elements, 0 failures;
  - calibration probe: 3:1 and 4:1 rows measured 3.3 and 4.4 (both fail), primary 16.2 (passes);
  - REAL-WIDGET placed-and-read=yes;
  - 79 PNG, 5 MP4, artifact 12159295214.
- TonoKit 69/69 on hosted Linux in the same run.
- ci-gate [39184377684](https://github.com/raydocs/tono/actions/runs/39184377684) success.
- Local: `swift test` 69/69; PacketTunnel two-module stub typecheck, 0 errors (confirmed to catch a reintroduced `graphRunning`); App model and services stub typecheck, 0 new errors.

**Not run:**
- the real Network Extension (heartbeat, refusal and restore inside NE; NE does not run in the simulator);
- a real device;
- signing, IPA, TestFlight;
- the widget and Control Center reading a live App Group status (the unsigned simulator has no App Group, so the system widget shows "Status unavailable");
- VoiceOver by a person; haptics; 120 Hz; on-device performance.

The new UI behaviour tests use injected faults in the DEBUG preview through the real `RouteApply`, `TunnelGraph` and `StatusWording`. They do not use a running tunnel.
