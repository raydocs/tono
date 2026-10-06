# SeaScene prioritized motion polish — 2026-10-04

Draft #1375, baseline `9f266c99`, unmounted PR 1 only. Owner-supplied
[review brief](review-brief.md): A1–4, B10–11, C19–21 and E30 implemented.
C18/progress and all home/native integration remain deferred; other effects
await owner review. This is MacBook Google Chrome headless, **not** Windows /
WebView2 / low-end / RDP / native-occlusion qualification.

## Visuals

[Comparison](comparison.png): exact previous head on the left, new scene on the
right. Static 920×600 crops `(380,200,920,450)`, rows connected / connecting /
failed / idle. Explicit static makes the dock opaque and freezes loops for the
comparison; ambient behavior is checked separately. An early capture made while
Vite's new-asset resolution was stale was discarded, not used as final proof.

| Phase | Minimum | Default | Simulated large viewport |
|---|---|---|---|
| Connected | [860×540](connected-860x540.png) | [920×600](connected-920x600.png) | [1920×1080](connected-1920x1080.png) |
| Connecting | [860×540](connecting-860x540.png) | [920×600](connecting-920x600.png) | [1920×1080](connecting-1920x1080.png) |
| Failed | [860×540](failed-860x540.png) | [920×600](failed-920x600.png) | [1920×1080](failed-1920x1080.png) |
| Idle | [860×540](idle-860x540.png) | [920×600](idle-920x600.png) | [1920×1080](idle-1920x1080.png) |

Native-frame films (labels are actual image timestamps, not exact requested times):
[sunset](film-sunset.png), [sunrise](film-sunrise.png),
[arrival](film-arrival.png), [failure](film-failure.png).
Choreography details: [arrival ~200ms](arrival-200ms.png),
[dawn ~550ms](sunrise-550ms.png), [sunset ~3.2s](sunset-3200ms.png).

## Movement, lifecycle and materials

[Browser assertions](browser-checks.json) verify counterflow, `.sea-loop`
coverage, arrival freeze/resume/static cancellation, 1.5s hidden-transition
hold, reversal, early stars/afterglow, moon exit and static/material preferences.
[Loop-wrap checks](wrap-checks.json) seek each plane/counter pair across its
actual iteration boundary, accounting for the negative delay: the transforms
cancel on both sides. These are geometry checks, not a screenshot claim of
perfect physically simulated waves.

[Steady pixel activity](steady-pixels.json): two PNGs ~2s apart; changed if any
RGB channel differs by more than 5/255. Equal harness and regions for exact
baseline and new scene, not directly comparable to the review's frame spacing.
The open water region left of the solar column goes from 0% to 20.66–23.42%
changed pixels. This does not measure visual taste. Inspect the ambient preview.
Pairs are retained as `steady-<phase>-0.png` / `steady-<phase>-1.png`.
Sky motion remains restrained; full cloud traversals, larger star fields,
shooting stars and extra halo/ember loops are intentionally deferred.

[Reduced transparency](prefers-reduced-transparency.png) keeps 28 running
animations and makes the dock opaque. [Reduced motion](prefers-reduced-motion.png)
and [forced colors](forced-colors.png) snap/stop. The unsupported-backdrop CSS
branch was inspected, and the JS regression with support=false passes; no actual
unsupported CSS engine is emulated by Chrome's `CSS.supports` override.

## Brightness

[Native swap timestamps](timestamps.json) and [means/rolling windows](luminance.json).
Method: Chrome `Page.screencastFrame` PNG, everyNthFrame=6; PNG→L,
crop `(0,56,920,600)`, resize92×54, mean. Start from a static settled source phase,
then enable loops before the state change; this avoids measuring cold-load CSS
transitions. Do not derive image time from screenshot callback completion.

| Transition | First → last mean | Max rolling 300ms change | Direct pairs 300±5ms |
|---|---|---|---|
| Sunset | 77.88 → 28.53 | 7.35 | 7.00 (52 pairs) |
| Sunrise | 28.56 → 63.69 | 6.73 | 6.73 (26 pairs) |
| Arrival | 63.81 → 77.86 | 3.19 | 3.18 (25 pairs) |
| Failure | 63.81 → 39.31 | 7.06 | 7.04 (25 pairs) |

Rolling means are interpolated between native samples; evaluate extrema at
sample boundaries and boundaries shifted by300ms. Gaps reach353ms. This is
sampled evidence, not every-window or exact-cadence proof. Sunset's settled
ambient variation includes +.084 in300ms, within the <=1 tolerance; no strict
mathematical monotonicity claim for a scene with live water. All four sampled
maxima remain below8. Full-size raw PNGs and scripts are retained locally at
`/tmp/tono-motion-20261004`, not committed as a large archive.

## Performance / integrity

Stage counters/1s pacing: [A4](performance-stage-a.json),
[B10](performance-stage-b10.json), [B11](performance-stage-b11.json),
[final](performance-final.json). Intermediate B10/B11 used .075 swell opacity;
final visual review reduced it to .04 and jittered the baked spacing. Each stage
has0 Paint/Layout/RasterTask in3s across all four phases; final style updates
27/31/27/27. Token extraction after capture was checked against actual computed
24/31,8/11,40/65s and500ms values; no retiming/paint changes.

Final steady traces: [connected](final-connected.json.gz),
[connecting](final-connecting.json.gz), [failed](final-failed.json.gz),
[idle](final-idle.json.gz). [Hidden trace](hidden-trace.json.gz) has0 Paint/Layout/
RasterTask and one empty UpdateLayoutTree event, not zero style work. The first
QA assertion incorrectly demanded zero style events too; it was corrected to
the paint/layout/raster invariant, without changing production source.

[Matched baseline pacing](pacing-baseline.json) and [final pacing](pacing-final.json)
are ~30fps, p9533.4ms. Early runs were ~60fps; a fresh Chrome retry remained~30.
The matched baseline has the same limitation; no measured speedup,60fps guarantee
or Windows qualification is claimed. FPS uses frame intervals / actual elapsed
time, not frame count divided by an assumed duration.

[Deterministic hashes/PNG checks](asset-checks.json): ten assets, valid CRC,
dimensions and filter0 row encoding; repeated bake byte-identical, grain unchanged.
Four narrow Vitests, TypeScript, scoped ESLint/Biome and Vite build passed.
SeaScene CSS/dev entry/baked assets remain absent from production output.
No locale changes/global i18n-clean claim, native builds, packaging, merge or deploy.
[Contract, accepted approximations and deferred items](../../sea-scene-preview.md#motion-polish--2026-10-04).
