**Verification — UI round 3, head `da33078` (iOS sources identical to `63066f0`; `da33078` adds the changelog only)**

Red check:
- `testAccessibilityAuditHomeStates` / `Sheets` / `LargestText` failed on run [39071414305](https://github.com/raydocs/tono/actions/runs/39071414305) @ `9a097b6`. Assertion `XCTAssertTrue(failures.isEmpty)` reported: hit area too small (status line and timer nodes), clipped-text predictions on the medium-detent sheets, and unmeasured contrast.
- Run [39074124929](https://github.com/raydocs/tono/actions/runs/39074124929) @ `f8b589f` failed the same three tests. Its AX5 English capture showed the exit capsule breaking "Toky / o · / Da…", fixed in `2bb5052`.
- The off-screen contrast measurement (1.1:1) failed on run [39076577038](https://github.com/raydocs/tono/actions/runs/39076577038) @ `2bb5052` and measures 16.6:1 once scrolled into view.

Ran (passed): iOS CI [39078716807](https://github.com/raydocs/tono/actions/runs/39078716807) @ `63066f0`:
- TonoKit + sing-box route checks (Linux)
- libbox build, unsigned Release device build, Debug simulator build
- install and launch with 46 screenshots, `state-cycle.mp4`, `state-cycle-reduce-motion.mp4` and `perf.txt`
- `Executed 9 tests, with 0 failures`: 6 interaction tests and 3 accessibility-audit tests

Audit triage (in `ui-tests.log`, nothing silently dropped):
- 27 contrast flags. Element-attributed flags are re-measured from pixels and pass (≥5.3:1).
- Unattributed contrast and hit-area flags (3–5 per home screen) trigger a sweep of every on-screen text and control. Every sweep found 0 below 4.5:1 and 0 under 44×44 pt.
- 5 "may be clipped at larger sizes" predictions at AX5 are logged and checked against the AX5 English captures.

Not run:
- real device
- VoiceOver by hand
- haptics
- ProMotion frame pacing and on-device CPU/memory
- real sign-in, catalog and tunnel (DNS/IPv6/UDP/On Demand)
- signing, IPA, TestFlight (owner)
- Android (separate thread, untouched)

All UI evidence is the DEBUG fixture preview on a GitHub-hosted simulator.
