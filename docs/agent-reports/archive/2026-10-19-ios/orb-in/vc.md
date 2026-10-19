Verification, round 4 — head `dbcae08` (docs-only changelog on top of code head `35cdff4`)

**Red check:**
- TonoKit `ConnectionStateTests.testReasserting` against the old `ConnectionState`: `XCTAssertEqual failed: ("nil") is not equal to ("Optional("NETWORK_CHANGED")")` (Linux `swift test`).
- Hosted CI on the earlier heads failed, then the same checks passed:
  - [39084572728](https://github.com/raydocs/tono/actions/runs/39084572728) @ `f8fa697`: `'TonoActivityAttributes' is only available in iOS 16.1`
  - [39085570631](https://github.com/raydocs/tono/actions/runs/39085570631) @ `d532218`: widget gallery text-clipped / dynamicType audit, sheet-primer text-clipped at the medium detent
  - [39088664883](https://github.com/raydocs/tono/actions/runs/39088664883) @ `2f35044`: VoiceOver-order test (XCUI enumerates layout order, so the test was removed and VoiceOver order is listed under Not run)

**Ran:**
- [39091191911](https://github.com/raydocs/tono/actions/runs/39091191911) @ `35cdff4`, all green:
  - TonoKit Linux + macOS
  - libbox
  - unsigned Release device build incl. `TonoWidgets.appex`
  - Debug simulator
  - 15/15 XCUITests: 12 flows incl. the system-rendered Live Activity in the Dynamic Island, 3 accessibility-audit / perf tests. 11 sweeps with 0 failing; 74 AUDIT lines all resolved.
  - Artifact 12122929452 (55 PNG + 3 MP4), until 2026-11-01.
- Linux `swift test` (TonoKit): 59 pass, including 8 `StatusSnapshotTests` and the `HapticCue` test.
- Simulator sample, Mac host: CPU 5.34 s per measured block; memory about 58 MB physical, about 61 MB peak.

**Not run:**
- No device was used: Control Center switch, widgets placed on a real Home/Lock Screen, `SetTunnelIntent` in the app process, VoiceOver reading order and hands-on use, haptics, ProMotion 120 Hz frame pacing, on-device CPU/memory, the real tunnel / catalog / network.
- No signing, IPA or TestFlight.
- `ci-gate`: ios-ci is not wired into it.
