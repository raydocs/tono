# SeaScene — isolated Windows 0.0.75 preview

Scope: handoff section 8 **PR 1 only**, under [SHIP_PLAN](SHIP_PLAN.md). Draft,
not a 0.0.74 G4 freeze exception. No production mount, preference, native window
change, dashboard rewrite, state mapping, routing/protection change or new logo.

## Reproduce

From `apps/windows/app`:

```sh
pnpm install --frozen-lockfile
pnpm web:dev --host 127.0.0.1
# Open http://127.0.0.1:3000/dev/sea-scene/index.html?lang=zh
# ?phase=idle, connecting, failed or connected; &fit; &static; lang=en
# &progress=0..1 opts into caller-controlled connecting progress
python3 scripts/bake-sea-textures.py
pnpm exec vitest run src/tono-ui/SeaScene.test.tsx
pnpm exec tsc --noEmit
pnpm exec eslint --max-warnings=0 src/tono-ui/SeaScene.tsx src/tono-ui/SeaScene.test.tsx src/tono-ui/MeshBackground.tsx src/dev/sea-scene/main.tsx
pnpm exec biome check src/tono-ui/SeaScene.tsx src/tono-ui/SeaScene.test.tsx src/tono-ui/sea-scene.css src/tono-ui/tokens/motion.css src/dev/sea-scene
pnpm exec vite build
pnpm i18n:check
pnpm i18n:types
```

This HTML has its own React/i18n entry; it does not bootstrap the Tauri app or
make native/network calls. Vite's production input remains `src/index.html`.
The preview rejects non-development execution. Production output contains no
SeaScene CSS, preview HTML or baked textures. Its English/Chinese preview keys
are in the ordinary locale/type system; other inactive locales are not expanded.

## Component contract and deliberate refinements

- `SeaScene({ phase, paused, progress? })` is inert and `aria-hidden`. A decorative phase is
  **not** protection evidence. A future caller must require `hasLiveProtection`
  for `connected`; PR 1 adds no caller or real state mapping.
- At 920×600 the horizon is y=330, sun diameter 190 and centre (620,185).
  Horizon follows 55% height and centre follows 67.3913% width. Diameter is
  `clamp(190px, 26% of scene height, 300px)` via scene-local container units;
  position, phase travel, glow and reflection size scale together. Mirror remains
  vertically stretched 1.45×. No subtree remounts on phase changes.
- Optional finite `progress` is clamped to 0–1 and ignored outside `connecting`.
  At reference scale the offset is `205px − 150px × progress`; mirror shares
  the opposite offset/easing, each update takes 900ms. Omit/non-finite input
  keeps 125px. No timer, inferred connection stage or autonomous progress.
  Progress retargets received while hidden are held like phase retargets.
- Bake seeded, depth-dependent ripple ribbons and white grain once using the stdlib script.
  Ripple width stretches with the scene; its depth stays 270px, preserving the
  drawn water scale rather than enlarging ripples on a maximised window. No SVG
  turbulence, displacement, blur filter, canvas pass or JS frame loop ships.
- Replace animated colors with opacity cross-fades of prepainted warm/red layers.
  Only transform and opacity animate; glass is confined to the preview dock.
- Dawn sky uses `--tono-ambient-ease-dawn` (`.25,0,.75,1`) rather than the
  prototype's `.4,0,.4,1`: the reference's measured dawn had a +9.0 luminance
  step and the first port +8.33, above the handoff's +8 limit. The broader curve
  reduces the peak without slowing the 2600ms sky or desynchronising the sun.
- Labels/actions in the preview update on the React commit, without the
  prototype's delayed text entrance. Production text/control timing is unchanged.
- Document visibility freezes loops and in-flight CSS transitions (including
  delayed moon fades) at their current presentation, then resumes them. A phase
  received while hidden is retargeted and held; canceled transitions are not
  revived. The Web Animations API is used only on visibility/hidden phase commits,
  not per frame. Unmount cancels retained transitions. `paused` instead selects
  a static destination: native occlusion/minimisation, closed tray or known
  software rendering must be passed explicitly by a future caller. No unreliable
  GPU/remote-desktop detection is claimed. Media changes are subscribed/unsubscribed.
- Reduced motion, forced colors and explicit static mode snap to the right phase,
  stop loops and make the preview dock opaque. Per the 2026-10-04 review E30,
  reduced transparency and missing backdrop-filter affect only dock material:
  the dock becomes opaque while scene motion remains enabled. The component
  has no app theme or transparency-slider coupling in PR 1.

## Measured evidence (MacBook, Chrome headless; 2026-10-03)

[Four phases × three sizes](screenshots/sea-scene-2026-10-03/README.md),
[raw browser checks](screenshots/sea-scene-2026-10-03/browser-checks.json),
[brightness samples](screenshots/sea-scene-2026-10-03/luminance.json) and
[3-second steady ambient trace](screenshots/sea-scene-2026-10-03/ambient-trace.json.gz).
Decompress the trace with `gzip -dc` and load its JSON into Chrome Performance.

| Check | Observed result |
|---|---|
| Sunset, real-time nominal 300ms samples | 78.14 → 27.57; max step 7.39; max rise +0.002 (< +1 tolerance) |
| Dawn after curve refinement | 27.52 → 64.98; max step 7.27, all sampled steps positive |
| Arrival / failure | max steps 2.93 / 7.67; failure settling variation +0.124 |
| Sunset→connect / sunrise→cancel at 1100ms | persistent DOM; immediate displacement 2.399 / 1.557px (continued presentation motion, not a jump to the destination); label updated on first rAF |
| Reduced motion / transparency | media emulation matched; static phase, all loops paused, moon transition 0s, dock backdrop-filter none |
| Explicit static / simulated missing backdrop-filter | static destination, moon transition 0s, opaque dock |
| Simulated document hidden, 300ms | water animation time unchanged; resumes after visibility event |
| 5-second rAF pacing | 301 frames, 60.2fps, p95 16.7ms / max 16.8ms; MacBook only |
| Steady 3-second trace | Paint=0, Layout=0, RasterTask=0; no element filter/SVG filter; 55 UpdateLayoutTree events (not zero main-thread style work) |

Brightness uses the handoff's method: PNG→L, crop `(0,56,920,600)`, resize to
`(92,54)`, mean pixels. Samples are real-time, not virtual-time fast-forward;
actual capture completion timestamps include ~130–170ms screenshot overhead.
Absolute means include the preview's different disclaimer/controls and should
not be treated as a pixel-identical full-home comparison. Baked water is an
intentional approximation of the prototype's live distortion, not a new palette.

### Continuation: transient visibility is not static mode

The first visibility check covered only a water loop. A deeper audit found that
`data-paused` also removed transitions, so a sunset jumped from y=36.75 to its
290px destination on hide/show. The new narrow regression was run against the
old source and failed (expected `pause` once, observed zero); both tests now pass.
Only explicit static/media fallbacks remove transitions. Temporary hiding pauses
scene-owned CSS transitions without imperatively playing CSS loops.

[Raw visibility checks](screenshots/sea-scene-2026-10-03/visibility-continuation.json),
[performance counters](screenshots/sea-scene-2026-10-03/performance-continuation.json),
[visible trace](screenshots/sea-scene-2026-10-03/ambient-visible-continuation.json.gz)
and [hidden trace](screenshots/sea-scene-2026-10-03/ambient-hidden-continuation.json.gz)
append evidence without replacing the original samples/screenshots.

- Sunset: y=36.74 before hide, 38.49 after the pause commit, then exactly 38.49
  after 400ms and on resume; continued to 79.03 after another 300ms. The initial
  1.75px is one presentation frame, not a jump to 290. All 28 transition clocks,
  sun/mirror and the water loop held, including delayed moon fades.
- Background retarget to connecting held y=20.96 throughout and completed at
  y=125 after resume. Reduced motion enabled while hidden snapped to y=290,
  canceled transitions and remained static after showing; no loop override.
- Fresh 3s traces: visible Paint/Layout/RasterTask=0, UpdateLayoutTree=65;
  simulated hidden Paint/Layout/RasterTask/UpdateLayoutTree=0. The visible style
  work is not a regression budget claim or zero-style claim. Pausing individual
  decorative groups did not consistently remove it, so no speculative
  `will-change`, extra layers or phase timers were shipped.
- Fresh pacing: 302 frames / 5016.5ms, 60.00fps, p95/max 16.8ms. MacBook Chrome
  only, simulated `document.hidden`, not native Windows qualification.
- Palette, baked assets, geometry and easing were unchanged by this lifecycle-only
  continuation (`cb0c5e2b`). The subsequently requested visual polish is below.

### Visual polish: moving, tapered reflection ribbons

[Latest comparisons and raw evidence](screenshots/sea-scene-2026-10-03/visual-polish/README.md).
Following the owner's request to continue the visual refinements:

- Bake each ribbon with its own seeded phase/wavelength, variable width, density
  and feathering. Fine, comparatively continuous distant ripples become more
  curved and fragmented nearby instead of uniformly filled horizontal bands.
  The same two 920×270 grayscale masks remain; repeated baking is byte-identical,
  PNG CRC/row encoding was checked and the grain asset is unchanged.
- Move the **whole masked ripple** with each existing 3.1/3.8s wobble, rather than
  moving only its sun disk behind a fixed striped mask. Keep the same transform
  range, loops, phases, sun/mirror curve and 1.45× vertical stretch. Remove only
  the two obsolete wrappers; no new animation, per-frame mask update or JS work.
- Clouds use a softer, lower-opacity radial envelope in the same RGB tint,
  replacing the flat dark centre and vertical mask. Geometry, drift timing,
  approved RGB palette and every phase/timing token are unchanged. No new filter.
- Review all four phases at 860×540, 920×600 and simulated 1920×1080. Static
  before/after crops control animation timing; their dock is intentionally opaque.
- New real-time nominal 300ms brightness: sunset 78.03→27.60, max step 7.01,
  max rise +0.003; dawn 27.51→64.34, max step 7.07 and all steps positive;
  arrival/failure max steps 2.95/7.46. Completion timestamps are retained, including
  one delayed screenshot; not a claim of exact capture cadence.
- Existing interaction checks still pass: persistent reversals 2.334/1.508px,
  labels on first rAF, reduced-motion/transparency and explicit static fallbacks;
  all 28 transition clocks held while hidden, including moon delays, and hidden
  retarget/static changes still behave correctly.
- Two fresh 3s visible traces: Paint/Layout/RasterTask=0, UpdateLayoutTree=65/54;
  simulated hidden all four counters=0. Correct interval-based pacing is about
  60fps, p95 16.7ms/max 16.8ms. This is MacBook Chrome only, not a performance
  improvement claim or Windows qualification. Main-thread style work remains.

### Review correction: frame timestamps and remaining fidelity limits

The full Anthropic review of `a97c963e...b053c638` found no major-or-worse
issue, but noted that callback completion timestamps do not prove a 300ms image
cadence. The nominal values above are historical samples, not strict cadence
proof. Normalising them by callback duration is also invalid: that duration is
not the image's presentation time. No source timing change was made to force a
measurement pass.

Repeat capture used Chrome's `Page.screencastFrame` PNGs, `everyNthFrame=6`, and
its native metadata `timestamp` (the runtime protocol describes it as "Frame
swap timestamp"). [Raw timestamps](screenshots/sea-scene-2026-10-03/visual-polish/timestamps.json),
[means and rolling windows](screenshots/sea-scene-2026-10-03/visual-polish/luminance-stamped.json)
and [timestamped sample frames](screenshots/sea-scene-2026-10-03/visual-polish/stamped-frames.png)
retain the correction. The same PNG→L/crop/resize method is used.

- Rolling 300ms changes, interpolating means between adjacent native frames:
  sunset max 7.37; dawn max 7.29. Direct measured frame pairs separated by 300±5ms:
  sunset max 7.43; dawn max 6.90. Both methods stay below 8 in this run.
- Native gaps covering the steepest windows are 89–105ms for sunset and 95–103ms
  for dawn. The run also has initial/other gaps up to 348/369ms: no perfect cadence
  or analytical guarantee for every possible 300ms window is claimed. Raw
  frames/timestamps remain available; this is measured sampling, not virtual time.

Two minor **visual-fidelity engineering items were left open after this correction
pass**. The owner-supplied 2026-10-04 review E31 accepts these approximations;
this is not a product/protection defect or a claim of pixel-identical matching:

1. The transform timing/curve remains shared by sun/mirror, but some auxiliary
   opacity easings differ from normative `WinHome.dc.html`: failed day/dusk/stars
   and idle day/stars/glow/path/light use the port's grouped sky easing; idle
   mirror opacity uses 6000ms rather than 2800ms, red overlay 2200ms rather than
   2000ms, and shade follows sun time/easing rather than the reference's separate
   shade curve. The dawn sky change is intentional and already documented;
   other differences are retained port approximations, not new owner approvals.
2. Mirror soft glow is fixed `#ff824c` instead of the prototype's phase tint;
   idle water glow uses `#e2443f` rather than RGB(150,44,62). Warm/red cross-fades
   approximate connecting glitter/water colors too. The opacity-only port
   removes animated colors but does **not** reproduce every original color
   interpolation. This polish preserves its existing RGB values, not exact
   prototype palette equivalence. Those endpoints are accepted approximations, not exact prototype matching.

The stale question-4 wording is superseded by new [decision 056](decisions/056-2026-10-03-windows-frameless-direction.md);
055 is immutable historical scope. No native window change is implemented.
Review status/coverage for subsequent exact heads is recorded in PR comments.

## Motion polish — 2026-10-04

**Historical first pass at a83bfd42; ROUND-2 below is the current contract/evidence.**

The owner's supplied review correctly identifies weak, concentrated steady-state
motion, not an absence of animations. Same-harness baseline samples confirm no
changed pixels above 5/255 in the water region left of the sun column; the new
surface layers animate that region too. [Scope, comparison, films and raw evidence](screenshots/sea-scene-2026-10-04-motion/README.md).

At `a83bfd42`, implemented only the prioritized independent batch (the later ROUND-2 pass below supersedes its deferred list):

- **A1–2:** feather the mirrored disc by 14px, apply a dimmer/redder prepainted
  reflection, reduce connected mirror opacity from .3 to .1 and connecting .8
  to .6. Reflection disc strength .6 is a layer opacity, not a measured claim
  that final pixel luminance is exactly 60% of the sun.
- **A3:** two deterministic soft RGBA cloud bands with irregular bodies and a
  restrained warm underside replace ruler-straight dark gradients. Existing
  slow drift is retained; full-width 90–140s cloud passes (B13) are deferred.
- **A4:** two periodic baked speck masks drift in opposite directions at 8/11s
  behind a fixed feathered perspective wedge. Warm/red paints cross-fade by
  opacity. Remove the 28 duplicate solar bar loops; the five lunar bars remain
  deliberately unchanged pending B15.
- **B10–11:** whole-water folds drift at 40/65s at .04 opacity each. Mirrored
  ripple planes travel toward the viewer at 24/31s; matching counter-transforms
  keep the sun disc anchored, including across loop wraps. No animated mask
  property or JavaScript frame work. New durations remain separate ambient tokens.
- **C19:** a causal 900ms halo bloom and 600ms path sweep occur once on entering
  connected, never on initial mount. All carry `.sea-loop`, pause when hidden,
  cancel under static mode and do not replay when static mode is released.
- **C20–21:** six early stars fade in over 3000ms; a narrow afterglow fades for
  6600ms, covering the sun/moon handoff. Moon/path exit in 500ms before the dawn
  sun is substantially visible. Keep the shared sun/mirror transform curves.
- **E30:** glass preferences/support no longer freeze the scene. Reduced motion,
  forced colors, explicit paused and transient visibility still work separately.

New narrow regressions were actually run before their implementations: glass-only
fallback failed with `static` instead of `ambient`; arrival entry failed with no
attribute. Four tests now pass. TypeScript, scoped ESLint/Biome and Vite build
pass; deterministic rebake, PNG CRC/dimensions/rows and unchanged grain pass.
Production output still contains no SeaScene CSS/dev HTML/baked image assets.
No locale source changes; the earlier scanner's inactive/legacy gaps are not
reclassified as globally clean.

- Same-harness 2s RGB-difference samples: water outside the sun column changes
  from **0% to 20.66–23.42%**, depending on phase. This measures spatial activity,
  not aesthetic quality; low-contrast motion remains subtle. Sky motion stays
  restrained in this batch; halo breathing/cloud passes/star expansion are deferred.
- Native-frame rolling 300ms brightness, with explicitly interpolated means:
  sunset max 7.35, dawn 6.73, arrival 3.19, failure 7.06; all below 8. Sunset
  settled ambient variation rises by up to .084, within the <=1 tolerance; do
  not call an animated steady scene mathematically monotonic. Native capture
  gaps reach 353ms, so this is sampled evidence, not every-window proof.
- Each stage (A4, B10, B11) and all four final steady phases have 0 Paint/Layout/
  RasterTask in 3s traces. Final style updates are 27/31/27/27. Simulated hidden
  trace has 0 Paint/Layout/RasterTask and one empty style event, not zero style work.
- This session observed both ~60fps early and ~30fps later. A fresh Chrome
  retry did not resolve it. **Exact 9f baseline and final in the same harness
  are both ~30fps, p95 33.4ms.** No 60fps, speedup or Windows qualification claim.
- Browser checks hold every active transition/loop for 1.5s when hidden and
  freeze/resume the arrival one-shots; reversals stay continuous. At 550ms into
  dawn moon opacity is zero; at sunset 1.6s early/other star opacity is .72/.15,
  and at 3.2s afterglow opacity remains .12. Static/material preferences pass.
  Missing-backdrop CSS fallback is inspected and the JS-support regression passes;
  Chrome cannot emulate an actually unsupported CSS engine.

**Deferred:** C18 and C25–29 are PR 2/later integration; A5–9, B12–17, C22–24
await owner effect review. Optional parallax/failure hesitation are not added.
Windows/WebView2/low-end/RDP/native occlusion tests remain unrun. The PR remains
draft; owner arranges external review and no automatic reviewer is invoked.
[Decision 057](decisions/057-2026-10-04-sea-scene-motion-polish.md) records this
scope/fallback update without modifying historical decisions.

Historical initial delivery: narrow vitest (two tests), TypeScript, scoped ESLint/Biome, Vite build
and i18n type generation passed. The locale scanner exits 0 but reports inactive
locale gaps and legacy backend unused/missing-source keys: **not a globally clean
i18n result**. English/Chinese frontend keys are clean; no bulk locale cleanup.

## Round 2 — 2026-10-04

Owner-supplied ROUND-2 Part A continues #1375, isolated/unmounted. [Four-state
2× comparisons, films, per-item data, large viewports and Chrome traces](screenshots/sea-scene-2026-10-04-round2/README.md).

- A1–6: short/dim failed ripples (sweep opacity0), clouds behind the sun, a soft
  near-horizon light column/stronger near specks and connecting reflection,
  depth-faded swells, local18px haze,1.5px disk feather/wider glow, SVG moon and
  no unsupported warm solar patch at night. Baked assets remain unchanged.
- A7–10:7.6s connected glow,110/137s one-way cloud passes; three star tiers,
  seeded3–9s twinkles on one third and bounded area-dependent count;700ms idle
  meteor per60s after a55s entry delay, canceled on any phase transition.
  Failed sun/inverse mirror bob by3 local pixels over5s, with6.4s ember breathing.
- A11: optional controlled progress, nine real keyboard-driven steps all rise
  in settled brightness, no autonomous advancement; hidden updates freeze and
  resume. **This is an input contract, not the real connection feed (PR2).**
- A12/13: `linear()` horizon linger, geometric disk boundary at3.740s vs2.652s
  with the old easing on the same new geometry;190/190/280.8/300px sun at
  860×540/920×600/1920×1080/2560×1440. Older CSS engines keep the190px/original
  easing fallback; an actual older engine was not tested.
- Steady sky changed pixels>5/255 over~2s: connected4.758%, idle.376%; open
  water9.59–12.13% after deliberately fading the scan-like lower folds.
- Every A1–A14 check and final four-phase3s traces have Paint/Layout/RasterTask0;
  observed~60fps/p9516.7–16.8ms at default and2560×1440. Earlier30fps results
  remain historical, not proof of a source-induced speedup. Final sampled
  rolling300 brightness maxima7.039/6.607/3.175/7.070; sunset rise≤.047,
  capture gaps≤350ms disclosed. Hidden trace0/0/0/style0; visible style work exists.
- A14 investigated: no unique masked-layer cause proved. Full first PNG capture
  ~173ms, unchanged captures similarly slow; format controls PNG158ms vs fast
  lossless PNG89ms/JPEG58ms, first rAF sees the new phase in2–17ms. Full-scene
  ablation draw max2.55ms; PNG format-control draw max1.402ms. This supports a
  **screenshot delivery/readback/encoding inference**, not an encoder CPU
  measurement, Windows guarantee or a claimed fix for a demonstrated UI freeze.
  Layer ablations alter image entropy too; raw traces/variance/outlier are attached.
- Six narrow vitests/typecheck/scoped ESLint/Biome/build pass; two new regressions
  were run and failed before their implementations. Two preview-only en/zh keys;
  i18n generated1118 keys, active frontend en/zh clean. Scanner exits0 but
  inactive/legacy gaps remain (overall missing6820), not globally clean.

[Decision062](decisions/062-2026-10-04-sea-scene-round2-contract.md) supersedes
only the earlier fixed-size/no-progress/deferred-sky scope. Owner directions
are recorded with2026-10-04 quotes: [top capsule058](decisions/058-2026-10-04-windows-top-navigation.md),
[collapsed clean steps059](decisions/059-2026-10-04-windows-home-collapsed-steps.md),
[details060](decisions/060-2026-10-04-windows-home-details-sheet.md),
[no bottom dock061](decisions/061-2026-10-04-windows-home-no-bottom-dock.md).
Repository status remains provisional because only the owner sets `owner`;
these choices are owner-selected, not reopened agent defaults. Part B then
Part C remain separate default-off drafts; no automatic merge/review. Optional
pointer parallax is not added; final home/native acceptance comes in Part C.

## Moonlight, arrival and depth — 2026-10-04

Owner approved the recommended first three follow-ups after ROUND-2. Replace
lunar bars with cool broken light and a12s halo breath; share two-depth glints
with the solar path (fine/slow far, wider/faster near, staggered shimmer); retime
arrival into an immediate quiet confirmation and a late settling bloom/sweep.
Keep all existing phase/progress inputs, sun/mirror curves, palette, fallbacks
and app/control logic. The same10baked assets are reused. Integral96/192CSS-pixel
tile periods correct a new fractional-period reset flicker found at2560 before
delivery. No additional particle engine, filter or JavaScript frame loop.

[Updated comparisons, films, viewport matrix, per-item data, narrow regressions
and lifecycle/seam traces](screenshots/sea-scene-2026-10-04-depth/README.md)
supersede the earlier deferred lunar-bar/arrival timing descriptions. Those
sections and images remain historical evidence. These were the only three effects
at that checkpoint; the next continuation below handles sunrise star ordering
and horizon shape. Home/control motion remains later work. The scene stays
isolated, unmounted and draft-only.

## Sunrise ordering and horizon shape — 2026-10-04

Owner approved continuing the two remaining scene refinements. Three persistent
star groups now fade dim → middle → bright with2000ms fades and0/300/600ms
delays, settling within the existing2600ms sky transition. Phase endpoints stay
unchanged (connecting.3, connected0); this stages the fade, not the connection.
Early bright sunset entry, seeded positions/counts and twinkle clocks remain.

All three `SunDisk` copies share a centered, at-most3% vertical compression.
Connected/full connecting progress is round; default connecting is.98, halfway
progress.9775, lower sun/failed.97. Targets follow existing local travel values,
not window pixels or an autonomous clock. CSS interpolates this small optical
approximation; it is not continuous physical refraction. Sunset shape waits
until18% of its4600ms travel, then settles by55% while the disc crosses the
horizon; travel/easing, glow, progress and reflection stretch are unchanged.

A new in-flight reduced-motion check exposed the existing afterglow phase rule
overriding the static guard. Move the scene guards after all phase rules so
reduced motion/forced colors/explicit pause snap every transition, including
that6600ms afterglow. No connection or control behavior changes.

[Current close-ups, native-timestamp films, ordering/shape/lifecycle data and
per-step/default/large measurements](screenshots/sea-scene-2026-10-04-sunrise/README.md).
Previous evidence remains historical. Windows hardware acceptance and PR2/3
remain pending; this continuation does not mount the scene or start home work.

## Not verified / not implemented

Real Windows/WebView2 frame pacing, low-end or remote-desktop hardware, native
visibility/occlusion and real Windows maximisation: **not run** on this MacBook.
The 1920×1080 and 2560×1440 images are simulated large viewports, not Windows device evidence.
No native builds, Tauri, packaging, merge, deployment or customer publish.

Protection mapping, all real dashboard cards, light theme, navigation, chrome,
tray sizing and branded icons are later PRs. Section 7 questions 1–5 were asked
together. The owner selected visual frameless/full-bleed Windows chrome (question
4), with Windows controls at top right and native drag/resize/maximise/snap
qualification; [decision 056](decisions/056-2026-10-03-windows-frameless-direction.md) records it and this PR does not implement it. Question 3 was subsequently selected as a top capsule ([decision 058](decisions/058-2026-10-04-windows-top-navigation.md)); questions 1, 2 and 5 remain open with ROUND-2 defaults
before PR 2. The original provisional scope remains in
[decision 055](decisions/055-2026-10-03-windows-sea-scene-preview.md).
