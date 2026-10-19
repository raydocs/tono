Verification for head `cf5093d` (code identical to `e0f5586`; `cf5093d` only adds the changelog lines).

Red check:
- `PrimaryActionTests.testInFlightStartOffersCancelAndRunningTunnelOffersDisconnect` with `.preparing` mapped to `.connect`: `XCTAssertEqual failed: ("connect") is not equal to ("cancel")` (Linux, Swift 6.4.1, local).
- `TunnelStopTests.testUserStartFailureIsNotTreatedLikeASystemStop` with classify returning `.stoppedBySystem` for user starts: failed (local mutation).
- Build regressions, each red on hosted CI before the fix: run 39051525587 `Undefined symbols _OBJC_CLASS_$_UIDevice` (PacketTunnel link) → UIKit linked; run 39052466967 `Localizable.strings: Couldn't parse property list` → header comment fixed; run 39053124674 `'HTTP1.Failure' initializer is inaccessible` → public init.

Ran:
- iOS CI run 39057008451 @ e0f5586: Linux job (sync check, TonoKit `swift test`, sing-box CLI check + route harness) ✓; macOS job (TonoKit tests, libbox build, XcodeGen, unsigned Release device build, Debug simulator build, simulator install + 25 launches + screenshots/video) ✓.
- ci-gate on e0f5586 ✓ (iOS paths not covered by ci-gate; its jobs skipped).
- Local: `swift test` 50/50; `tools/sync-desktop-routing.py --check`; `tools/check-singbox.sh` 4 graphs; two-module stub typecheck of App Services/Model and PacketTunnel against TonoKit (reproduces the HTTP1.Failure error on the old code, clean after).

Not run:
- Any signed or on-device build; tunnel start, real catalog, DNS/IPv6/UDP/LAN, On Demand recovery, extension memory (no Apple team, no iPhone).
- VoiceOver walkthrough, Reduce Motion and Reduce Transparency captures (code paths exist, not rendered), haptics.
- TestFlight / App Store Connect upload (not authorized; prerequisites listed in README).
- Independent high-risk review (draft, not merging).
