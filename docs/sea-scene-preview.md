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

- `SeaScene({ phase, paused })` is inert and `aria-hidden`. A decorative phase is
  **not** protection evidence. A future caller must require `hasLiveProtection`
  for `connected`; PR 1 adds no caller or real state mapping.
- At 920×600 the horizon is y=330, sun diameter 190 and centre (620,185).
  Horizon follows 55% height, centre follows 67.3913% width, diameter stays fixed.
  Sun/mirror destination transforms and timing remain the prototype's, including
  1.45× vertical reflection. No subtree remounts on phase changes.
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
- Reduced motion/transparency, forced colors, no backdrop-filter and explicit
  static mode snap to the right phase, stop loops and make the preview dock opaque.
  The component has no app theme or transparency-slider coupling in PR 1.

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

Two minor **visual-fidelity engineering items remain open after this correction
pass**, not product/protection defects or a claim of pixel-identical matching:

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
   prototype palette equivalence. Aligning those endpoints remains a follow-up.

The stale question-4 wording is superseded by new [decision 056](decisions/056-2026-10-03-windows-frameless-direction.md);
055 is immutable historical scope. No native window change is implemented.
Review status/coverage for subsequent exact heads is recorded in PR comments.

Frontend: narrow vitest (two tests), TypeScript, scoped ESLint/Biome, Vite build
and i18n type generation passed. The locale scanner exits 0 but reports inactive
locale gaps and legacy backend unused/missing-source keys: **not a globally clean
i18n result**. English/Chinese frontend keys are clean; no bulk locale cleanup.

## Not verified / not implemented

Real Windows/WebView2 frame pacing, low-end or remote-desktop hardware, native
visibility/occlusion and real Windows maximisation: **not run** on this MacBook.
The 1920×1080 images are a simulated large viewport, not Windows device evidence.
No native builds, Tauri, packaging, merge, deployment or customer publish.

Protection mapping, all real dashboard cards, light theme, navigation, chrome,
tray sizing and branded icons are later PRs. Section 7 questions 1–5 were asked
together. The owner selected visual frameless/full-bleed Windows chrome (question
4), with Windows controls at top right and native drag/resize/maximise/snap
qualification; [decision 056](decisions/056-2026-10-03-windows-frameless-direction.md) records it and this PR does not implement it. Questions 1–3 and 5 remain pending
before PR 2. The original provisional scope remains in
[decision 055](decisions/055-2026-10-03-windows-sea-scene-preview.md).
