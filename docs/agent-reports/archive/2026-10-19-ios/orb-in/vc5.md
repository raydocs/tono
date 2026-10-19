Verification, round 5: head `21ffa22` (docs-only changelog on top of code head `1b7e983`)

**Red check:**
- [39097318071](https://github.com/raydocs/tono/actions/runs/39097318071) @ `ea131b9` failed. Its contrast sweep reported:
  - `SWEEP home-CONNECTING: measured 1.2:1 under WCAG AA | label=Cancel`
  - `SWEEP largest-text-connected: measured 1.1:1 under WCAG AA | label=Disconnect`
- Cause: the `GlassEffectContainer` drew the capsule's background glass over its label (blurred in en-03/en-04). `1b7e983` removed it, and the same sweep passes.

**Ran:**
- [39099937341](https://github.com/raydocs/tono/actions/runs/39099937341) @ `1b7e983`, all green:
  - TonoKit Linux and macOS
  - libbox
  - unsigned Release device build including `TonoWidgets.appex`, compiling the custom `tono.sun.on/off` symbols
  - Debug simulator build
  - `Executed 15 tests, with 0 failures`
- Artifact 12126403272, kept until 2026-11-01: 57 PNG and 4 MP4, including `sheet-zoom.mp4`, `settings-scrolled-under-bar.png` and `en-17c-widgets-control-symbols.png`.
- Simulator sample on the Mac host: CPU 5.3 s per block, about 58 MB memory.

**Not run:**
- No device: haptics, ProMotion 120 Hz pacing, Liquid Glass refraction and the interactive glass response under a finger, VoiceOver order and hands-on use, on-device CPU/memory, the real tunnel and network.
- No system surfaces: the Control Center switch and widgets placed on a real Home or Lock Screen; the custom symbols were seen only inside the app.
- No signing, IPA or TestFlight.
- `ci-gate`: ios-ci is not wired into it.
