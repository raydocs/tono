## 2026-09-26 · May the G3 test kit use the production v1 update pointer before G4?

- Status: owner
- Chosen: yes. The one-round G1–G3 test kit publishes its signed update pair behind
  `releases.afk.ccwu.cc/desktop/v1/latest/manifest.json`, which no shipped customer build
  reads (0.0.67 / 0.0.34 use Sparkle `public/appcast.xml` and `public/windows/latest.json`).
  Customer feeds stay untouched until G1–G3 are ticked. Rejected: testing G3 only after
  publish, a second device round.
- Why: owner, 2026-09-26 in chat; conditional on the plan review confirming no shipped build
  reads the pointer. The kit's own builds do read it (NativeUpdateDownload.swift:5,15;
  update_wire.rs:5). During the owner's round it serves only the kit's signed pair: the
  failure-target manifest while the owner runs the injected-failure step, then the
  success-target manifest, where it stays until G4; that package is the exact candidate the
  owner accepts and G4 publishes, and the kit's release sequences are the ones the published
  build continues from. Nothing else is placed behind it.
- Applied in: G1–G3 test kit (this session).
