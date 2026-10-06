# SeaScene ROUND-2 — isolated draft #1375

Owner-supplied [brief](brief.md), Part A only, baseline `a83bfd42`. Deferred Windows
0.0.75 work under [SHIP_PLAN](../../SHIP_PLAN.md); no home, shell or native mount.
MacBook Google Chrome154.0.8037.93 headless at1×, Node26.10.0. All sizes here are
simulated viewports, **not Windows/WebView2/low-end/RDP hardware qualification**.
The preview's old dock is a synthetic test control, not the final Part B/C home.

## Visual acceptance

- [Exact a83 vs ROUND-2, 2× crops](comparison-2x.png), connected / connecting /
  failed / idle. Same `(400,90,800,450)` region in retained repository stills.
- [Reviewer-supplied before closeups](before-closeups.png) alongside
  [new closeups](after-closeups.png). Their crop framing differs; use the exact
  repository comparison for matched framing. Static freezes loops and uses an
  opaque preview dock; ambient behavior is verified separately.
- A1: shorten/dim the failed path, dim its soft mirror, retain short rippled light.
  Browser evidence shows arrival sweep opacity0 in failed, not a leaked one-shot.
- A2: clouds paint behind the sun, avoiding olive overlays on its face.
- A3/A4: a broad, soft light column and extra near specks; a feathered connecting
  reflection with greater near-horizon strength. Layer opacity is not a calibrated
  percentage of final sun pixel luminance.
- A5/A6: swells fade before the bottom100px; local18px horizon haze;1.5px disk
  feather and wider glow; antialiased SVG crescent; solar light/mirror fade to0
  at night. The moon still has the five original lunar bars (not Part A work).

| Phase | 860×540 | 920×600 | 1920×1080 | 2560×1440 |
|---|---|---|---|---|
| Connected | [min](connected-860x540.png) | [default](connected-920x600.png) | [large](connected-1920x1080.png) | [large](connected-2560x1440.png) |
| Connecting | [min](connecting-860x540.png) | [default](connecting-920x600.png) | [large](connecting-1920x1080.png) | [large](connecting-2560x1440.png) |
| Failed | [min](failed-860x540.png) | [default](failed-920x600.png) | [large](failed-1920x1080.png) | [large](failed-2560x1440.png) |
| Idle | [min](idle-860x540.png) | [default](idle-920x600.png) | [large](idle-1920x1080.png) | [large](idle-2560x1440.png) |

[Geometry](geometry.json): sun190 /190 /280.8 /300px (offsetWidth rounds281).
Scene-local `cqh`, not viewport height including preview controls; sun/glow/travel
scale together. Stars45 /54 /200 /200: density follows area with a200-star cap
for bounded layer cost. Old-engine CSS fallbacks retain190px/the original easing;
those fallback branches were inspected, not tested in an actually older engine.

## Steady sky, lifecycle and progress

A7/A8:7.6s connected glow breath (.9–1,1–1.03 scale);110/137s one-way cloud
passes, offscreen wrap endpoints. A9: three star sizes/brightness tiers, restrained
warm/cool tints, seeded3–9s periods on one third, area-dependent count. A55s idle
entry delay precedes a700ms shooting star every60s; entering any other phase
cancels it. A10: failed sun±3px/5s with inverse mirror bob and6.4s ember pulse.

[Steady pixel differences](steady-pixels.json), real PNG pairs about2s apart,
changed if any RGB channel differs by>5/255. Sky region `(0,56,920,330)`:
connected **4.758%**, connecting1.655%, failed2.062%, idle **.376%**. Open water
`(0,330,450,490)`:9.589 /9.900 /11.218 /12.129%. The depth fade deliberately
reduces water activity from the earlier pass; changed-pixel area is not a taste
score or directly comparable to the review's different crop/cadence.

[Browser checks](browser-checks.json) prove four-phase static/hidden holds,
transform/opacity-only `.sea-loop` coverage, hidden progress retarget/resume,
persistent root/sun, reversal, meteor delay/seeked700ms visibility/cancellation,
failed sweep0 and independent media/material behavior. The first harness wrongly
expected the intentionally paused connecting-only halo to resume in connected;
it was corrected to check only originally running clocks, without a source fix.
[Wrap checks](wrap-checks.json) prove ripple/counter transforms sum to0 across
both actual period boundaries, including the second layer's negative delay.
[Reduced motion](prefers-reduced-motion.png),
[reduced transparency](prefers-reduced-transparency.png),
[forced colors](forced-colors.png). Unsupported backdrop-filter is a source/
unit check, not an emulated unsupported CSS engine. [Meteor scrub still](meteor-seek-55300ms.png)
is an explicit timeline seek, not a claim of waiting a full minute.

A11: [nine real keyboard input steps](film-progress.png), [values/geometry/brightness](progress.json).
Caller-controlled0–1 changes the reference-scale offset205→55px over900ms per
change; mirror has the opposite offset and same easing. All nine settled frame
means rise; holding the final input2s does not alter it. Omitted/non-finite input
keeps125px, other phases ignore it; bounds/no autonomous progress are unit tested.
No actual backend stage feed is added. Static and hidden input behavior also pass.

## Transitions and pacing

Films label actual native frame-swap timestamps, not requested target times:
[sunset](film-sunset.png), [sunrise](film-sunrise.png),
[arrival](film-arrival.png), [failure](film-failure.png).
[Luminance samples](luminance.json), [native timestamps](timestamps.json),
[per-item measurements](per-item.json). Crop `(0,56,920,600)`, grayscale resized
92×54; rolling300ms extrema at native/interpolated boundary points, plus direct
300±5ms pairs. Capture gaps reach350ms, so this is sampled evidence, **not**
every-window proof or exact300ms cadence. Small settled ambient fluctuations are
allowed by the original ≤1 sunset-rise tolerance, not mathematically monotonic.

A12: [direct geometry timing](linger.json) uses the same new geometry with old
cubic easing as a control: disc bounding top crosses the horizon at2.652s vs
**3.740s** with `linear()`. This is a geometric boundary, not a pixel-perfect
feather-disappearance claim or an exact recreation of the old source. The moon
and early stars bridge the handoff; no control waits on scene transitions.

The table below is generated from independent checks after each item. All four
3s steady traces per item have Paint/Layout/RasterTask0; pacing about60fps,
p9516.7–16.8ms. Stage variation is not an isolated causal benchmark.

| After item | Sunset max rolling300 | Sunrise max rolling300 | Connected fps /p95 ms |
|---|---:|---:|---:|
| A1 | 7.231 | 6.688 | 60.0 /16.7 |
| A2 | 7.241 | 6.824 | 60.0 /16.7 |
| A3 | 7.324 | 6.862 | 60.0 /16.7 |
| A4 | 7.362 | 6.865 | 60.0 /16.7 |
| A5 | 7.335 | 6.859 | 60.0 /16.7 |
| A6 | 7.471 | 6.629 | 60.0 /16.8 |
| A7 | 7.456 | 6.639 | 60.0 /16.7 |
| A8 | 7.445 | 6.684 | 60.0 /16.7 |
| A9 | 7.505 | 6.638 | 60.0 /16.8 |
| A10 | 7.461 | 6.616 | 60.0 /16.7 |
| A11 | 7.408 | 6.715 | 60.0 /16.7 |
| A12 | 7.055 | 6.611 | 60.0 /16.7 |
| A13 | 7.027 | 6.608 | 60.0 /16.7 |
| A14 | 7.060 | 6.648 | 60.0 /16.8 |

Final post-feature-fallback [measurements](performance-final.json): sunset 77.99→27.29,
max rolling300 7.039; sunrise max 6.607,
arrival 3.175, failure 7.070; sunset rise≤0.047.
Final visible style events64/67/62/64, Paint/Layout/RasterTask0 in each3s trace. Earlier30fps results
remain historical; this session does not prove a source-induced30→60fps speedup.
At2560×1440, all four3s traces also have Paint/Layout/RasterTask0,119–124 style
events, ~60fps/p9516.7–16.8ms. [Large performance](performance-large.json),
[steady pacing](pacing-steady.json). Hidden3s trace:0 Paint/Layout/RasterTask/style.
No zero-style-work claim for the visible scene.

Trace files: `trace-{connected,connecting,failed,idle}.json.gz`,
`trace-large-<phase>.json.gz`, `trace-hidden.json.gz`. Decompress and load in
Chrome DevTools Performance/trace viewer. Traces are checked for steady work,
not initial navigation, intentional resize or label-layout work at phase commits.

## A14: first capture latency is not a measured UI freeze

[Baseline ablation](latency-baseline.json), [final ablation](latency-final.json),
[format controls](capture-formats.json). Six warm samples per variant,920×600,
same capture path; no source/assets mutated during a browser check. Ablations
change the rendered image as well as compositor work: not a pure layer-cost
benchmark, and order/CPU/encoding variance prevents causal millisecond claims.

- Baseline first PNG captures: full192ms; path off182; ripples off187; swells
  off158; reflection off163; grain off135; all masks/grain off121. Unchanged
  captures cost roughly as much as changed captures; phase commits2–6ms.
- Final: full173ms; path off158; ripples off159; swells off161; reflection off183;
  grain off160; all off117. **No unique new masked layer was identified as the
  claimed cause.** Individual removals do not remove the capture delay.
- Same final scene, format controls: PNG158ms, lossless speed-optimised PNG89ms,
  JPEG80%58ms, WebP84ms. Unchanged captures157/93/61/78ms respectively. First
  rAF observes the target phase in2–17ms. Format dependence supports an inference
  that screenshot delivery/readback/encoding accounts for much of the apparent
  stall; encoder CPU time was not separately instrumented.
- Full baseline/final ablation draw max2.47/2.55ms. Format-control PNG trace:
  `ProxyImpl::ScheduledActionDraw`142 events,total131.74ms,max1.402ms; JPEG88
  events,total83.52ms,max1.610ms. Forced-capture/phase-commit traces contain
  transient Paint/Layout/RasterTask, unlike the separate steady traces. The
  reflection-off run has a10.7ms draw outlier; no claim of universal sub3ms draws.

[`trace-latency-*-full.json.gz`](trace-latency-final-full.json.gz),
`trace-capture-{png,png-fast,jpeg}.json.gz` carry the supporting events.
This diagnoses the screenshot metric; it does **not** guarantee Windows cost,
explain the older under10ms claim, or pretend to fix a demonstrated rendering
freeze. No speculative layer promotion/removal or lower-quality scene was shipped
to optimise a screenshot encoder. Real WebView2/GPU-less/RDP remains unrun.

## Local verification and retained raw evidence

Six narrow vitests, TypeScript, scoped ESLint/Biome and Vite build pass. New
progress and area-density tests were run on their pre-implementation behavior
and failed. No dependency or baked image change; retained10 assets validated.
Production output excludes scene/dev entry/image assets. `i18n:types`1118 keys;
`i18n:check` exits0, en/zh frontend missing/unused0, but inactive locale and legacy
backend totals remain (overall missing6820): **not globally clean**.

Full native PNGs, per-item traces/logs and the CDP harness are retained locally in
`/tmp/tono-round2-20261004/`, not deleted. `measure.mjs` uses screencast native
metadata timestamps; `brightness.py` checks the sampled extrema. `check-stage.mjs`
records3s traces and separate rAF pacing; `latency.mjs` and `capture-formats.mjs`
perform the ablations/format controls. Committed films are selected native frames,
not every full-resolution PNG. See [versions](versions.txt) and main preview doc
for the frontend reproduction commands. No production connection is simulated.

No automatic external model review, native build, packaging, merge, auto-merge,
deploy or publish. Optional pointer parallax is not added. Part B/C and final
home acceptance wait for their own draft branches and owner hardware acceptance.
