# ROUND-3 S0 — scene close-out, 2026-10-05

Draft#1375, [SHIP_PLAN](../../SHIP_PLAN.md), deferred0.0.75 UI only. Baseline
`dd0f09f506f64d1034c267b58b80536269bfb8ef`. MacBook/Chrome154/M3Pro/Metal,
not Windows or Edge qualification. The scene is still unmounted in the app.

## Look first

- [Supplied fault sheet](handoff-closeups.png), [matching2× before/after crops](faults-2x.png),
  [moon scaling2×](moon-scale-2x.png), [three-tier plates](tiers.webp).
- Actual sampled motion: [Full](full-motion.webp), [Lite](lite-motion.webp),
  [Static snaps](static-motion.webp). Lossy WEBP is display evidence, not the
  numeric source. [Full](full-timestamps.json), [Lite](lite-timestamps.json) and
  [Static](static-timestamps.json) preserve native frame-swap timestamps.
  Individual `<tier>-<transition>-film.webp` sheets cover all four transitions.
- Idle: [920×600](idle-920.png), [1920×1080](idle-1920.png),
  [2560×1440](idle-2560.png). These are simulated viewports, not Windows devices.

## Four faults

1. Replace the empty shadow cut-out with filled prepainted radial glow and a
   feathered irradiance edge; no live blur/filter or animated paint values.
   [Rim measurement](rim-palette.json), baseline[control](rim-before.json):
   native1× PNG→L, bilinear ellipse normals every0.25°, minimum of rim offsets
   −1/0/+1px versus sky6px outside. Only visible sky circumference (both samples
   above y329) is counted; crop enlargement does not affect measurement.
   Connected/connecting/failed: **1440/803/311** normals, **zero darker samples**;
   minimum deltas **+4.72/+1.72/+4.44**. Baseline had764/640/291 darker samples.
   [Nine Full breathing/bob extrema](rim-extrema.json) also have zero negatives;
   minimum across them is+1.57. This is finite raster sampling, not an analytical
   claim about every possible viewport/time.
2. Reflection uses one stationary330×270 baked envelope: **32px side feather**
   at reference scale (scales upward), taper/fragmentation and falling depth
   brightness. It remains intentionally faint, not a bright striped jar; the
   existing near-horizon warm lift supplies the first40px. The10old PNGs remain
   byte-identical; only `reflection-envelope.png` is new.
3. Layer-isolation control proved the low-sun diagonal came from the mirror,
   not the speck path. Failed and finite caller progress≤0 remove that mirror;
   diffuse surface light and persistent speck DOM remain. No remount/loop reset.
4. Moon/halo/path share the sun's container-unit clamp. At1920, halo140→**206.89**,
   rotated SVG box49.48→**73.11**, path168×170→**248.28×251.23** CSSpx.
   [Geometry](geometry.json); nominal crescent SVG40→59.11 CSSpx. Integral96/192px
   glint tile periods stay unscaled, preserving the previously fixed loop seams.

## Indigo and brightness

At x200 in the static920×600 idle PNG:

| y | Baseline RGB | S0 RGB | Requested approximate RGB |
|---|---|---|---|
|240|36,22,36|22,26,53|26,29,56|
|290|57,33,44|33,40,72|34,38,70|
|328|75,54,56|50,59,94|52,58,96|
|340|34,20,31|20,24,42|18,22,40|

The target values were approximate, not previously rendered. [Raw measurements](rim-palette.json)
include x460/620/880 too; local haze/cloud/grain/light explains spatial variation.
At x460,y340 the result is19,22,40. **Every pixel in the top150px of the matched
idle PNG is unchanged** (RGB maximum delta0), not just the four sampled columns.
Night palettes start cross-fading at3800ms, after the existing sun horizon
crossing≈3740ms. Additive premultiplied cross-fades prevent an artificial dark
midpoint; all movement remains transform/opacity.

[Native brightness samples](luminance.json), original handoff crop
`(0,56,920,600)`→92×54→L mean: sunset **79.45→27.25**, maximum interpolated rolling
300ms step **7.333**, direct300±5ms pairs7.355; terminal within27.3±1.5.
Maximum positive300ms fluctuation **+0.018** from living steady-state layers;
not a strict mathematical monotonicity claim. Native gaps reach348ms, so these
samples do not prove every continuous300ms window.

Full-preview sunrise/arrival/failure max steps6.566/3.742/6.862. The historical
all-transition diagnostic **fails sunrise direction** (−1.634) because connecting
now immediately makes the synthetic dock opaque, as required; do not label that
check green. [Same-denominator scene contribution](luminance-scene-contribution.json)
zeros the fixed dock rectangle `(56,500,864,568)` before the same crop/resize:
sunrise has no negative300ms step (minimum+0.0485), maxima7.270/6.557/3.722/6.801.
It is an isolation control, not a replacement for the handoff sunset metric.
The first S0 glow overshot8.662 and a normal-alpha cross-fade dipped then rose;
those failed raw captures remain in `/tmp/tono-round3-20261005/final-frames/`.

## Tiers, activity and pacing

[All12checks](tiers-checks.json), [steady pixel activity](activity.json). PNG
pairs1.6s apart; a pixel changes if any RGB channel differs by>5/255. Sky crop
`(0,56,920,330)`, water `(0,330,920,490)`; no new diagnostic overlay in captures.

|Phase|Full sky / water %|Lite sky / water %|Static sky / water %|
|---|---|---|---|
|Connected|4.22 /8.89|0 /7.80|0 /0|
|Connecting|1.36 /7.93|0 /7.35|0 /0|
|Failed|2.55 /6.84|0 /6.09|0 /0|
|Idle|0.50 /8.96|0 /8.68|0 /0|

Changed area is not a taste/performance score. Full retains sky breath/drift;
Lite deliberately has a still sky but living water and phase transitions.
Static has no running scene clocks or pixel changes. Full/Lite/static external
1s rAF pacing is≈60fps/p95≤16.8ms on this Mac; static's60fps describes browser
callbacks, not moving scene frames. All12three-second steady traces have
**Paint/Layout/RasterTask0**; style updates Full59–64, Lite20, Static0. Raw
`<tier>-<phase>-trace.json.gz` files can be loaded into Chrome Performance.

[Large2560×1440](large-checks.json): all four Full traces Paint/Layout/Raster0,
≈60fps/p95≤16.8ms, style121–128. [First large control](large-first.json) included
onePaint/Layout event in three phases because hiding the diagnostic was not
flushed before tracing; unchanged-source retry waits200ms. Both retained.
The first Lite idle check found a CSS-specificity shooting-star leak despite
its removed loop class; the stronger Lite guard fixes it. Failure evidence
remains in `/tmp/tono-round3-20261005/tiers-failed/`.

## Probe and lifecycle

[Audit](quality-lifecycle.json): one device-local down-only measurement; total
3s visible frame budget,1500ms checkpoint, then Lite's own p95. Software names
Basic Render/SwiftShader/llvmpipe start Lite. Saved completed results do not run
again on reload; explicitly selecting Auto or Remeasure rearms. Manual tiers
measure without auto-downgrade. The callback stops on the final frame boundary
(observed3016.53ms,181 intervals), not continuously. Static/reduced/forced do
not sample; readout uses dashes rather than fabricated FPS/renderer values.
No rendering occurs in the RAF callback, only numeric interval collection.

Audit:183callbacks/pending0 after completion; hidden callbacks hold, reload has
0callbacks, explicit rearm ends, reduced/forced choose Static. Renderer was
`ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)`.
[Browser controls](browser-checks.json): phase/progress retargets pause/resume,
all loops use transform/opacity, Moon fades/meteor/reversal remain persistent,
media/material fallbacks stay independent; hidden3s trace all counters0.

## Standalone bundle and checks

[Download the web-only ZIP](tono-sea-preview.zip), extract, open
`tono-sea-preview/index.html` in Edge; append `?lang=zh&fit`. [Instructions](WINDOWS-PREVIEW.txt).
This is not a native app package. Its classic IIFE, inline PNGs and separate CSS
need no module-file fetch or installed dependencies. `sources.json` in the ZIP
records exact SHA256 build inputs rather than pretending a dirty build is a
previous commit. [File-mode receipt](file-preview.json): Chrome file:// tested
Full/Lite/Static/Auto and phase buttons, no external network requests/JS errors.
**Edge/Windows itself has not run.** The first library-mode build failed on a
Node `process.env.NODE_ENV` reference; explicit browser production definition
fixes it, and the failed file receipt is retained locally.

- PASS14narrow tests in3files; stored-Lite regression failed on old code first.
- PASSplain TypeScript **and full ratchet79/79**, scoped ESLint/Biome, production
  Vite and standalone builds. Prior dd0CI failed79→82 due3unchecked test-group
  indices; optional access preserves the same assertions and fixes those3.
  This was not an activity-page defect. No baseline ratchet weakening.
- PASSproduction scene/preferences/dev entry/texture isolation; old10PNG hashes
  and control tokens unchanged. i18n1128keys: en/zh frontend clean; scanner exits0
  with existing inactive/legacy gaps, not a globally clean locale claim.
- [Seven supplied owner decisions](../../decisions/063-2026-10-05-windows-round3-appearance.md)
  recorded; no app mount, old customer-string changes, native build/package,
  automatic reviewer, auto-merge, deploy or publish.

Owner S0.5 **not run**: each state20s/four transitions, minimise during sunset,
Windows+weak machine, RDP if available, DPI125/150. Weak Full<30fps changes Auto's
initial default to Lite; current default remains provisionally Full. This gate
**does not block PR2 implementation**. Final home/control blur qualification is
PR2/3, not this synthetic dock. Scene design freezes after S0; later changes
only fix exposed defects. Raw PNGs/scripts/logs retained under
`/tmp/tono-round3-20261005`; committed WEBP is compressed convenience evidence.
