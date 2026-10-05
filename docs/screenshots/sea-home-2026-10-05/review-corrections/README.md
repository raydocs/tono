# Owner-review corrections — PR #1393, 2026-10-05

Corrects H1–H12 and the narrow S2 scene defect from the owner's independent
MacBook review of d2dd8f21. Source code through70f870b9;
[exact input fingerprints](source-fingerprints.json). **Draft, not merged.**
MacBook M3 Pro, macOS26.5.2, headless Chrome154.0.8037.93, actual DashboardPage/
status-push/SWR components with synthetic native IO. No host VPN transaction,
automatic external review or Windows/hardware acceptance claim.

## What changed / inspect

- H1–H5: one main retry/restore/line chip, no buttons or duplicated failure body
  in the explanation card. Quiet diagnostic/backup/DNS tools remain outside it.
  Missing/scheduled retry copy and heading follow the progress deadline, never
  the live protection flag alone. Smoked controls replace violet; details latency
  uses the warm accent. [Failed860](failed-860-review.png),
  [offline860](protectedOffline-860-review.png),
  [offline920](protectedOffline-920-review.png),
  [scheduled](scheduled-offline-review.png),
  [restore confirmation](restore-confirmation-review.png).
- H2/H6 follow-up: the longer truthful sentence originally exhausted the card
  budget in long English at minimum size. Narrow failed/offline columns now use
  the available width and start at16%, leaving a meaningful internal scroll area.
  [English860](long-en-protectedOffline-860-review.png),
  [before failure](controls/long-en-protectedOffline-860-review.png).
- H6: fixed160px wash feather in both Full/Lite, not a sharp right edge. Paragraph
  wraps on its readable side; wash still ends at60% and does not cover the sun.
  [Paired pixel profiles](wash-profiles.json): largest adjacent alpha change0.0154,
  not the former abrupt boundary. [Full](wash-full-on.png)/[Lite](wash-lite-on.png).
- H7–H11: chip/rows share codename-first localized city and measured83ms selected
  exit; other measurements come from the existing cache or remain a dash. Picked
  row has a check. Dedicated home titles omit ellipses; slow-stage composition
  trims them; clean collapsed steps are text-only; chevron is the existing12px
  icon. [Picker](switch-final.png), [long minimum](min-switch-final.png),
  [slow](slow-final.png), [expanded steps](expanded-steps-review.png).
- H12: one vertical details scroll, no shrinking/clipped two-column cards. AI
  remains mounted. [First card](details-final.png), [bottom](details-bottom-review.png),
  [all four card measurements / reachability](sheet-reachability.json).

[39 current review checks](review-checks.json) plus
[20 interaction/material/threshold checks](browser-checks.json) pass.
[Geometry](review-geometry.json) covers seven states at860×540,920×600,1920×1080,
plus long-English failures at minimum size. No page overflow or runtime exceptions;
failed/offline cards have zero buttons, positive useful height and their own scroll.
Keyboard focus/Escape/outside/return paths and reduced-motion/transparency were
rerun, not taken from the reviewer's report.

[Final visual catch](last-visual-checks.json): AI week bars now inherit a home-only warm
soft-accent; unmapped city rows no longer repeat their codename. The new identity
regression [actually fails before the fix](controls/unknown-city-before.txt).
[Warm AI chart](ai-bars-final.png). No extra moving layer or legacy city-map change.

## Text contrast / old appearance

[Background-only pixel measurement](contrast-results.json), actual94%-alpha
foreground, no shadow credit: minimum paragraph contrast8.34/9.07/13.68:1 at
860/920/1920 sidebar sizes;9.49:1 in the isolated920 canvas. These are connected
fixture rectangles, not a universal contrast certification for every possible text.

Fresh connected old/default-off light/dark fixture comparison against3f9:
[both pixel-identical, maxRGBDelta0](legacy-pixels.json),
[real page/no exceptions](legacy-control.json). Existing en/zh values and the
original dashboard/progress/Lines tests remain unchanged:
[baseline invariants](baseline-invariants.json). Not all old states/native windows.

## Input and motion film

[11s connect/arrival/disconnect/sunset movie](home-cycle.mp4),
[native timestamp metadata](film-timestamps.json),
[original JPEG frames](home-cycle-native-frames.zip).
Transactions are simulated native callbacks, not a real network connection.

[High-cadence pointer/label film](press-and-status.mp4),
[timing](press-film-timestamps.json), [original frames](press-native-frames.zip):
pressed destination observed53.5ms after pointer-down; label committed11.6ms after
click in the synthetic fixture. Both are finite and under100ms. Real IPC latency
is **not measured**; phase/title still follow the authoritative status commit.

## S2: diffuse reflection in the first60px

One prepainted pseudo-element on the existing gold light column, using its existing
opacity envelopes. No new moving loop/filter, texture, timing or global palette
change. This is the explicitly defect-exposed exception to the S0 freeze.
[On](near-light-on.png)/[off](near-light-off.png),
[controlled delta](near-light-results.json): RGB maximum14, pixel bounds
x491–748/y330–388; no sky/lower-water delta after animation pause promises settle.
The initial unsettled pair had2RGB sky noise and was rejected, not claimed confined.

[Exact original S0 reference sunset](s0-sunset-results.json): old standalone3f9
layout920×664, original brightness ROI(0,56)–(920,600), exact S2 CSS appended
in-browser; unchanged original CSS hash and patch hash in
[timestamps](s0-sunset-timestamps.json). After:79.54→27.91, maximum interpolated
rolling300ms change7.18; direct approximately300ms frame pairs max7.22. Before:
79.40→27.90/max7.20. Night difference0.009, within±1.5 of27.3. Tiny ambient rises
≤0.029 are below the existing+1 tolerance; no material reversal.
[Exact reduced grayscale calculation inputs](s0-brightness-inputs.zip).
Sampling is native frames/interpolation, **not exact300ms cadence** (largest gap282ms).

A first home-scene-only crop hid the UI and excluded the lower water; it yielded
9.17 after/9.20 before. That different exposure/ROI is **not** the original S0
acceptance measurement. [Failure retained](controls/measure-sunset.txt),
[alternate-ROI curve](sunset-results.json). No timings were retuned to hide it.

## Performance: current RAF pacing30fps, not the older60fps receipt

The four3s details-open traces captured the final motion/layer design before the
last constant soft-accent/unknown-city text correction (no added moving layer):
[ConnectedFull](connected-full-sheet.trace.json.gz),
[ConnectingFull](connecting-full-sheet.trace.json.gz),
[ConnectedLite](connected-lite-sheet.trace.json.gz),
[ConnectingLite](connecting-lite-sheet.trace.json.gz).
[Counts](performance.json): about30.00fps, p95=33.4ms; Paint/Layout0,
RasterTask1,92 style updates per run. Wide sheet/tiles have no blur; connecting/Lite
controls have no blur. Connected Full keeps blur only on small controls.

[Near-field on/off and blank control](near-field-performance-control.json):
30.00/30.00/29.84fps, all p95=33.4ms. FPS here is a3s requestAnimationFrame diagnostic, not a direct delivered-frame count.
Matching blank-page pacing is consistent with
an environment/frame-scheduler cadence ceiling (**inference**, not hardware diagnosis).
The off trace includes one paint/layout caused by its initial CSS toggle; on has
Paint/Layout0. Style CPU63.27ms(on)/35.38ms(off), not zero work or proof of identical
CPU cost. No observed pacing regression from the added field; **no current60fps
qualification**. Windows/WebView2, weak/no-GPU, RDP, occlusion,125%/150%DPI remain
not run. Owner five-minute check still decides the default quality.

## Current Edge preview / verification

[Download the updated scene-only ZIP](tono-sea-preview-s2.zip), extract it and open
`tono-sea-preview/index.html` in Edge. No server/Node required. It is **not the home
or a native app package**. The old3f9 ZIP remains historical, unchanged.
SHA-256 `aac8024f26e3789d656e7d2bf390d8dffa0c68e804bfd26148275f360580ea5d`;
[input hashes](bundle-sources.json), [file:// modes/phase checks](bundle-checks.json).
Only a MacBook browser opening is verified, not Windows Edge.

[Final source receipts](controls/final-source-checks.txt): full frontend
49files/351tests (18home regressions +one identity regression); TypeScript/index79/baseline79; ESLint0warnings;
Biome22files plus the new identity test checked separately; frontend build;1158-key generation/locale scan.30 additive keys per
en/zh, no existing value edits. Scanner still retains inactive/legacy gaps.
H12 narrow home/AI check19tests, not22.

## Instrumentation failures / repeatability

Controls retain old-code regression output, narrow-layout before captures, invalid
background shorthand/count assertions, invalid label timing, duplicate global
style declarations, CSS color-mix serialization/8-bit alpha quantization and the first bundle picker that included the remeasure button.
Four checks were resampled against backgroundColor/scheduled state; input timing
was resampled using the actual localized label and finite values. The final39
receipt combines34 valid original checks with those five fresh checks, not a
claim that the earlier audit exited successfully. No app logic changed for these
instrument mistakes. [Scripts](scripts/) are local CDP harnesses: repoint their
absolute temp/repo paths and owned Chrome port before rerunning. Final/focused,
press, S0-reference and bundle receipts correspond to their recorded methods.
