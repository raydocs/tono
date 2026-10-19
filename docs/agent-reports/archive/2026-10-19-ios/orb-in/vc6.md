Verification and formal re-score, round 6: head `91f7530` (changelog only on top of code head `f4553dc`)

**Red check:**
- [39103718199](https://github.com/raydocs/tono/actions/runs/39103718199) @ `159ebad`: `AUDIT sheet-settings: [131072] Text clipped | Text of this UITextField may be clipped`. The same audit passes at `f4553dc`.
- [39108037311](https://github.com/raydocs/tono/actions/runs/39108037311) @ `3861d8d`: `Executed 18 tests, with 1 test skipped`. The real-widget test could not find the Home Screen placement. I rewrote it to assert the system gallery instead, so it does not skip, and did not count that run as green.
- The new Other-line and stale-widget tests have **not** been run against the old code. On the old code, "Other line" only dismissed Details and the stale card led with "Connected", so both should fail there; that is reasoning, not a run.

**Ran:**
- [39111212441](https://github.com/raydocs/tono/actions/runs/39111212441) @ `f4553dc`, all green:
  - libbox, unsigned Release device build, Debug simulator build
  - `Executed 18 tests, with 0 failures`, 0 skipped
  - `REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`
  - 60 PNG and 4 MP4 in artifact 12131067795, kept until 2026-11-01
- Linux `swift test` (TonoKit): 60 pass, including `testLineLabelShowsOnlyWhenACityHasTwoLines`.

**Formal score** (rubric, weights and floors unchanged; each item is backed by `f4553dc` captures)

| Item | Max | Reviews (Opus / GPT) | Now | Evidence | Missing: design | Missing: device / signing |
|---|---|---|---|---|---|---|
| Hierarchy / few words | 20 | 17 / 18 | 18.5 | en-02…06, en-08, en-12, en-13, zh-Hans-04 | 1.5: Settings and Details density | — |
| One-handed | 20 | 17 / 16 | 18 | en-04 (gear in the bottom row; UI test checks the bottom third), other-line-opens-lines, sheet-zoom.mp4 | 1: interruption and back paths beyond the scripted flows | 1: outside-app controls on a phone |
| Brand | 15 | 13 / 14 | 14 | real-widget-home-screen, en-17c, live-activity-island-* | 0.5: preview tags crowd the gallery | 0.5: Control Center switch in its real host |
| Liquid Glass | 15 | 12 / 12 | 12 | en-04, settings-scrolled-under-bar, a11y-reduce-transparency-* | 2: capsules read as dark pills | 1: refraction and touch feel |
| Motion | 15 | 13 / 12 | 12.5 | state-cycle.mp4, sheet-zoom.mp4, en-03 vs en-12 (titles now differ) | 1: same sky for connecting and network change; cross-fade overlap | 1.5: haptics, 120 Hz |
| Accessibility | 10 | 7.5 / 8 | 8.5 | audits green on this head (home states, sheets, AX5); a11y-largest-text-en-connected | — | 1.5: VoiceOver order and hands-on use |
| Authenticity / performance | 5 | 3.5 / 3 | 3.5 | real widget in SpringBoard reading the real (empty) shared status; simulator perf on the Mac host | — | 1.5: device, tunnel, performance |
| **Total** | **100** | **83 / 83** | **87** | | **6** | **7** |

Passes the rubric floor: 87 ≥ 85 and every item ≥ 70%. Authenticity is exactly at its floor (3.5/5). It is not ≥ 95: even with every design gap closed, the ceiling without a device is about 93. My earlier self-score of 91 was higher than both independent reviews.

**Not run:**
- No device: haptics, ProMotion 120 Hz, VoiceOver by hand, glass feel, device CPU/memory, the real tunnel, catalog and network.
- Control Center switch in Control Center.
- Widget buttons running `SetTunnelIntent`.
- No signing, IPA or TestFlight.
- `ci-gate`: ios-ci is not wired into it.
