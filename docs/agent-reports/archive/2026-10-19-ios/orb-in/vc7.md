Verification and formal re-score, round 7: code head `1a75705` (changelog commit follows on top)

**Red check:**
- [39114598985](https://github.com/raydocs/tono/actions/runs/39114598985) @ `fc9c812`: 19 of 20 passed. The failure: `SWEEP home-network-changed: measured 3.5:1 under WCAG AA | label=Cancel frame=(22.0, 664.0, 358.0, 56.0)`.
  - The label was alone on a 358 pt capsule, so too few text pixels reached the sweep's percentile. Measured on the label box itself, the same pixels give 14.6:1.
  - Not fixed by loosening the sweep. The fix: the reconnecting capsule now keeps the session clock, which is true to iOS (the connected date survives reasserting). The same sweep passes at `1a75705`.
- In the same run, `state-cycle-en.mp4` showed the sunrise fill replaying on connected → reconnecting: the `onChange` closure read the previous `reason`. Fixed by keying the change on phase and reconnecting together. Frames at `1a75705` show the warm edge and the clock (47:09 → 47:12), with no fill.
- TonoKit `testNetworkChangeHoldsTheSunAboveAFirstStart`, run on Linux against code that ignores the reason: `XCTAssertEqual failed: ("rising") is not equal to ("reconnecting")`.
- The two new UI tests (swipe back from every sheet, interrupted start) were not run against older code. They cover paths that already worked, so they add coverage rather than show a red.

**Ran:**
- [39118209252](https://github.com/raydocs/tono/actions/runs/39118209252) @ `1a75705`, all green:
  - libbox, unsigned Release device build, Debug simulator build
  - `Executed 20 tests, with 0 failures`, 0 skipped
  - `REAL-WIDGET gallery-lists-tono=yes gallery-text-exposed=no placed-and-read=yes`
  - 61 PNG and 5 MP4, including the new `state-cycle-en.mp4` and `interrupted-start-arrives-connected.png`; artifact 12134207150, kept until 2026-11-01
- Linux `swift test` (TonoKit): 61 pass.
- Frame check of `state-cycle-en.mp4` (30 fps sample of the title band): every title change goes old → empty → new, never two titles at once.

**Formal score** (rubric, weights and floors unchanged; every row is backed by `1a75705` captures)

| Item | Max | Round 6 | Now | Evidence | Missing: design | Missing: device / signing |
|---|---|---|---|---|---|---|
| Hierarchy / few words | 20 | 18.5 | 19 | en-08 (34 fewer visible words), en-09 (mode titles only), zh-Hans-08/09 | 1: Settings still long (system and About) | — |
| One-handed | 20 | 18 | 19 | `testEverySheetClosesWithASwipeBackToHome`, `testStartInterruptedBySheetAndAppSwitchArrivesConnected`, interrupted-start-arrives-connected | — | 1: outside-app controls on a phone |
| Brand | 15 | 14 | 14.5 | en-17, en-17c (one tag corner, Lock Screen tags under), real-widget-home-screen | — | 0.5: Control Center switch in its real host |
| Liquid Glass | 15 | 12 | 12.5 | en-04 / en-05 / en-12 (scene tint, lit rim, sheen), a11y-reduce-transparency-* | 1.5: still a dark surface over the scrim | 1: refraction and touch feel |
| Motion | 15 | 12.5 | 13.5 | state-cycle-en.mp4 (reconnecting: held sun, sweep, clock; sequential swaps), state-cycle-reduce-motion.mp4 | — | 1.5: haptics, 120 Hz |
| Accessibility | 10 | 8.5 | 8.5 | audits green (home states incl. network-changed, sheets, AX5) | — | 1.5: VoiceOver order and hands-on use |
| Authenticity / performance | 5 | 3.5 | 3.5 | real widget in SpringBoard; simulator perf on the Mac host | — | 1.5: device, tunnel, performance |
| **Total** | **100** | **87** | **90.5** | | **2.5** | **7** |

- 90.5 passes the floor: ≥ 85, and every item is at least 70%.
- It is not ≥ 95. Without a device the ceiling is 93, and the 7 device and signing points are not claimed.
- This is a self-score. The last independent reviews (round 6 inputs) were 83 / 83, and my round-5 self-score of 91 was too high.

**Not run:**
- No device: haptics, ProMotion 120 Hz, VoiceOver by hand, glass feel, device CPU and memory, the real tunnel, catalog and network.
- The Control Center switch in Control Center.
- Widget buttons running `SetTunnelIntent`.
- No signing, IPA or TestFlight.
- `ci-gate`: ios-ci is not wired into it.
