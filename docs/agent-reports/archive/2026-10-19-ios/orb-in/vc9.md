Verification, round 9. Review baseline: code `b36d07d`; tip `8dd22e2` adds only the changelog. No score here: round 9 waits for blind reviews.

**Red check:**
- [39136687684](https://github.com/raydocs/tono/actions/runs/39136687684) @ `5662631`, 21 of 22 passed: `AUDIT sheet-settings: [8] Label not human-readable | label=preview@example.com`. The fix is the "Signed in as …" row; the audit is unchanged.
- TonoKit `testNetworkChangeSunSitsBelowAPartlyWorkingTunnel`, run on Linux with the old value 0.9: `XCTAssertLessThan failed: ("0.9") is not less than ("0.72")`.
- `testRouteCheckAnswerIsVisibleAfterSubmit` and `testRouteCheckAnswerFollowsTheMode` were **not** run against `217eb1e`. That code shows the defect in `details-route-check.png` (the keyboard is up and no answer is visible), and its answer text differs, so both should fail there. That is reasoning, not a run.

**Ran:**
- [39140462842](https://github.com/raydocs/tono/actions/runs/39140462842) @ `b36d07d`, all green:
  - libbox, unsigned Release device build, Debug simulator build
  - `Executed 22 tests, with 0 failures`, 0 skipped
  - `REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`
  - 65 PNG and 5 MP4, including `details-route-check.png`: keyboard gone, answer visible; artifact 12142836958, kept until 2026-11-01
- Linux `swift test` (TonoKit): 61 pass.

**Not run:**
- VoiceOver hearing the route-check announcement (posted with `UIAccessibility.post(.announcement)`; not observable in CI).
- No device: haptics, 120 Hz, glass feel, device performance, the real tunnel and network.
- Control Center switch in its host.
- Widget intents.
- No signing, IPA or TestFlight.
- `ci-gate` does not include ios-ci.
