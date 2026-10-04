# SeaScene — dawn ordering and horizon shape

Continuation of draft [#1375](https://github.com/raydocs/tono/pull/1375), baseline
`e40074177a7fe2be3009916da0562637d4158146`. Windows0.0.75 UI under
[SHIP_PLAN](../../SHIP_PLAN.md). Scene only: no home mount, protection/connection
logic, native window, routing, palette, texture/dependency change, automatic
model review, merge, package or deployment. Earlier evidence is retained.

## Changes and visual evidence

- **Dawn:** three persistent brightness-tier groups. Dim/middle/bright opacity
  transitions last2000ms with0/300/600ms delays; all settle by2600ms. Connecting
  still ends at.3, connected at0, rather than changing the existing phase colors.
  Seeded stars, density, twinkle and early bright sunset entry are preserved.
  [Real-time2× star crops](dawn-stars-2x.png) show the unchanged synthetic preview
  title; it is not the future home. At753ms the group opacities were.773/.898/.987.
- **Disk:** shared centered `scaleY` in all three `SunDisk` copies. Connected and
  full connecting progress remain round; default connecting.98, halfway.9775,
  low/failed.97. The targets derive from normalized travel, independent of scene
  size; CSS transitions interpolate them. This is a restrained target-based
  optical approximation, **not continuous physical refraction**. During arbitrary
  retargets, interpolation is not an exact position-to-shape mapping.
  [Matched2× halfway-progress comparison](horizon-comparison-2x.png),
  [sunset close-ups](sunset-shape.png), native
  [default](connecting-progress05-920x600.png)/
  [large](connecting-progress05-2560x1440.png) screenshots.
- **Sunset:** shape holds round until18% of4600ms, settles at3% compression by55%,
  while the existing travel lingers at the horizon. Shared travel, glow and1.45×
  reflection stretch remain unchanged. Old engines use the existing sunset ease.
- **Static correction:** an in-flight reduced-motion probe found the existing
  afterglow phase rule overriding the static transition guard. Put guards after
  all phase rules. [Failing diagnostic](target-before-static-fix.json) retains
  its running6600ms opacity transition; [corrected checks](static-checks.json)
  verify explicit pause/reduced motion/forced colors cancel it and all other
  transitions, snap shape and leave no running clocks. This is a draft-preview
  engineering correction, not a shipped customer defect.

Four native-frame films: [sunset](film-sunset.png), [sunrise](film-sunrise.png),
[arrival](film-arrival.png), [failure](film-failure.png). Each uses eight actual
frames, labeled with native frame-swap time relative to the phase click.

## Verification

[Targeted browser data](target-checks.json): real-time tier order/phase endpoints,
star/node identity, hidden delayed fades and shape/progress retarget holds/resume,
14 default/large static shape endpoints, bounded shared sun/mirror deformation,
atomic committed-phase reversal and reduced-motion snap. At707/1305/2104/3003ms
sunset, vertical scale was1/.99109/.97686/.97, equal across all disk copies. [Nine settled progress samples](progress-brightness.json)
remain strictly increasing in the same brightness crop with the new shape.

[General browser checks](browser-checks.json): four-phase static/compositor-only
loop coverage, hidden holds/resume, existing meteor guards and material fallbacks,
persistent reversal, failed sweep0 and hidden3s Paint/Layout/Raster/style0.
The first targeted harness accidentally returned DOM nodes through CDP and failed
serialization; corrected storage returns no DOM. No source change for that error.

MacBook Google Chrome154.0.8037.93 headless,1× device scale; **not Windows/WebView2**.
[Per-step results](per-step.json), [large results](performance-final-large.json).
Each steady trace covers3s; pacing uses a separate1s interval-based rAF sample.

| Stage | Sunset / sunrise / arrival / failure max300ms | Paint / Layout / RasterTask | Default fps / p95 |
|---|---|---|---|
| baseline | 7.067 / 6.668 / 3.204 / 7.047 | 0 / 0 / 0, four phases | ~60 / ≤16.7ms |
| stars | 7.041 / 6.691 / 3.215 / 7.090 | 0 / 0 / 0, four phases | ~60 / ≤16.8ms |
| final | 7.081 / 6.624 / 3.221 / 7.057 | 0 / 0 / 0, four phases | ~60 / ≤16.8ms |

Final default style counts49/52/49/49;2560×1440 counts106/110/108/106.
Large connected/connecting/idle pacing~60fps; the first failed sample was54fps
with one99.9ms interval, p9516.8ms. One unchanged-source narrow retry measured
~60fps/max16.8ms and Paint/Layout/Raster0, style107; both original and
[retry metadata](performance-retry-large.json)/traces are retained. No claim of a
source-induced speedup or universal frame-rate guarantee. Main-thread style work
is not zero. Decompress `final-*.json.gz` or `retry-large-failed.json.gz` for Chrome
Performance; [hidden trace](hidden-trace.json.gz) is separate.

Brightness uses PNG→L, crop`(0,56,920,600)`, resize`92×54`, mean; capture is
PNG/everyNthFrame6 with native `metadata.timestamp`. [Timestamps](timestamps.json),
[means](luminance.json). Rolling300ms changes interpolate between actual frames,
not perfect cadence/every-window proof. Final capture gap≤351.429ms; sunset
max rise+.0467 under the+1 tolerance. All max300ms changes stay below8.

[Frontend receipt](frontend-checks.txt): eight narrow tests, tsc, scoped ESLint,
Biome and Vite build. The [new tier regression](regression-before.txt) actually
failed on the old component (2 groups, not3); the
[old-shape browser probe](shape-before.txt) returned1/1/1 and failed before the
new shape. [Isolation receipt](isolation-check.txt): scene-local code/dev entry
and10baked textures excluded from production; source assets/control tokens
unchanged. Shared ambient tokens intentionally remain in the normal production
motion stylesheet; the initial guard incorrectly classified one as a scene leak.
No locale edits; the locale scanner was not repeated in this bounded batch.

Raw scripts, native PNG sequences, traces and failed controls:
`/tmp/tono-sunrise-20261004/`. Windows/WebView2/low-end/RDP/native visibility,
real connection feed and future home glass-over-motion remain **unrun**.
