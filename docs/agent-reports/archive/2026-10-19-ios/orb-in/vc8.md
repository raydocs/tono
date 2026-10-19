Verification, round 8 (review baseline: code `217eb1e`; tip `f7b7ddd` adds only the changelog). No score in this comment: the formal score waits for independent blind reviews of this head and will be posted with the implementer's self-score.

**Red check:**
- [39127157474](https://github.com/raydocs/tono/actions/runs/39127157474) @ `5586651`, 20 of 21 passed: `AUDIT sheet-details: Contrast failed | label=Settings frame=(20.0, 873.7, 362.0, 52.0) | measured 1.2:1 FAILS WCAG AA`. The route check as its own section had pushed the Settings row past the screen edge. The fix moves it into the routes card; the audit is unchanged and passes at `217eb1e`.
- `testRouteCheckInDetailsAnswers` was not run against the old code. On the old code Details had no input, so its first assertion would fail; that is reasoning, not a run.

**Ran:**
- [39130734441](https://github.com/raydocs/tono/actions/runs/39130734441) @ `217eb1e`, all green:
  - libbox, unsigned Release device build, Debug simulator build
  - `Executed 21 tests, with 0 failures`, 0 skipped
  - `REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`
  - 64 PNG and 5 MP4, new `en-/zh-Hans-09b-details-full` and `details-route-check`; artifact 12139096378, kept until 2026-11-01

**Not run:**
- No device: haptics, 120 Hz, VoiceOver by hand, glass feel, device performance, the real tunnel and network.
- The Control Center switch in Control Center.
- Widget intents.
- No signing, IPA or TestFlight.
- `ci-gate` does not include ios-ci.
- In `details-route-check.png` the answer line sits under the keyboard. The test asserts the answer exists (`TCP →`), but the capture does not show it.
