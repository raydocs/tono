# SeaScene — moonlight, arrival and depth polish

Owner-approved first three refinements after ROUND-2, continuing draft #1375.
Baseline `ff45cdf1`; Windows 0.0.75 UI work under [SHIP_PLAN](../../SHIP_PLAN.md).
Only the isolated scene, its test and ambient tokens change. No app/home mount,
connection/protection logic, native window, routing, new dependencies or palette change.
No automatic model review, merge, deployment or package.

## Visual changes

- **Moonlight:** replace the five lunar bars with cool broken light using the same
  two baked masks as the solar path. A 168×170 px feathered path stays aligned with
  the fixed moon. Its existing .34 opacity, delayed night entry and500ms dawn
  exit are retained. The halo breathes over12s, opacity.82–1/scale1–1.025; moon
  clocks pause outside idle rather than restarting at every phase change.
- **Arrival:** one persistent2400ms bloom has a small immediate confirmation
  (peak at 192ms), a quiet middle, and a restrained settling bloom (peak 1776ms).
  The water sweep starts at 1400ms and lasts900ms, near the end of the shared
  2400 ms sun/mirror travel. Labels/state still change immediately. Initial
  connected mounts do not play it; phase changes cancel it; static mode removes
  it without replay and hidden surfaces hold the delay as well as the active shot.
- **Perspective glints:** two fixed depth envelopes blend fine, slow distant
  fields into wider, faster nearby fields. Each depth has two opposing periodic
  baked fields, with staggered9.2/13.7 s opacity variation and distinct offsets.
  Near drift 8/11 s, far16/21 s. The far texture footprint is half the near footprint
  on both axes. Overlap creates local variation; this is a two-depth approximation,
  not individual particle simulation or a3D ocean. Solar plane count remains4;
  lunar 4 fields plus 1 halo replace 5 bar loops. No new texture asset is needed.

[Matched2× baseline/current crops](comparison-2x.png), connected/idle; same
`(400,90,800,450)` crop, static clocks/opaque synthetic preview dock. They compare
end-state appearance, not ambient clocks or the eventual home layout.
[Four phases × four sizes](viewport-matrix.png) and [geometry](geometry.json).
Native-size default screenshots: [connected](connected-920x600.png),
[connecting](connecting-920x600.png), [failed](failed-920x600.png),
[idle](idle-920x600.png). Connected/idle originals also cover860×540,
1920×1080 and2560×1440. All 16 original size/state captures remain in the raw folder.

Films use eight actual native-timestamp PNG frames each:
[sunset](film-sunset.png), [sunrise](film-sunrise.png),
[arrival](film-arrival.png), [failure](film-failure.png).

## Measurements

MacBook Google Chrome154.0.8037.93 headless, Node26.10.0,1× device scale.
These are simulated browser viewports, **not Windows/WebView2 hardware evidence**.
[Per-item baseline/moon/arrival/final data](per-item.json) preserves the figures
rather than claiming a speedup from changing pixel activity or capture variance.

| Step | Sunset / sunrise / arrival / failure max300ms | Four-phase3s Paint / Layout / RasterTask | FPS / p95 |
|---|---|---|---|
| before | 7.057 / 6.793 / 3.188 / 6.629 | 0 / 0 / 0 | ~60 / 16.7 ms |
| moon | 7.004 / 6.675 / 3.202 / 7.046 | 0 / 0 / 0 | ~60 / 16.7 ms |
| arrival | 6.925 / 6.684 / 3.217 / 7.092 | 0 / 0 / 0 | ~60 / 16.8 ms |
| final | 7.108 / 6.604 / 3.210 / 7.071 | 0 / 0 / 0 | ~60 / 16.8 ms |

Final sunset max sampled rise +0.0466 (< +1 tolerance); final native capture
gaps reach352.4 ms. Baseline failure had an 801ms gap, so its failure curve is
especially sparsely sampled. Default final style updates: 48 / 53 / 49 / 49;
2560 final style updates: 107 / 109 / 107 / 106. Both sizes observed~60fps,
p95≤16.8 ms. Hidden3s Paint/Layout/Raster/style are0/0/0/0.
After the integral-period fix, all 8 seam controls have 0 pixels changing above
5/255 RGB, maximum channel delta≤3 across±1 ms; see the actual clock matrices.

Brightness: handoff PNG→L, crop`(0,56,920,600)`, resize`92×54`, mean. Capture
uses `Page.screencastFrame` PNGs/everyNthFrame6 and its native frame-swap
`metadata.timestamp`. [Native timestamps](timestamps.json), [means and rolling
windows](luminance.json). Rolling300ms changes interpolate between actual frames;
this is sampled evidence, not a perfect cadence or mathematical every-window
monotonicity proof. Ambient settling variation is included and disclosed.

Default and2560×1440 four-phase3s steady traces record Paint/Layout/RasterTask
separately from main-thread style updates; style work is not zero. Decompress
`final-<phase>.json.gz`, `final-large-<phase>.json.gz` or
[hidden trace](hidden-trace.json.gz), then load JSON into Chrome Performance.
[Large pacing/trace metadata](performance-final-large.json).

## Lifecycle and boundary checks

[Browser checks](browser-checks.json): all four static destinations, every running
loop marked `.sea-loop` and transform/opacity-only; hidden holds/resumes, controlled
hidden progress retarget, unchanged meteor guards, material/media behavior,
persistent root/sun and a committed-phase reversal; failed sweep remains0.

[Polish checks](polish-checks.json): real-time early/late arrival sampling;
bloom/sweep clocks held exactly during a 1100ms hidden interval, including the
1400 ms sweep delay; resume and phase-cancel; cool solar/lunar depth structure,
12 s moon halo and unchanged500ms dawn exit. Times/opacities are observed samples,
not desired values hard-coded into the scene. Meteor/wrap seeks are explicit
clock controls, not claims of minute-long real-time playback.

[Loop seams](seams.json): freeze all other clocks and cross the actual
`delay + duration` first-iteration boundary by±1 ms, far/near solar and lunar
fields at920/2560. Integral96/192CSS-pixel vertical periods preserve the repeat
at large widths; path width and fixed depth envelopes still follow the scene.
[Before-fix control](seams-before-fix.json) retains the fractional-period failure:
2560solar far/near had712/15changed pixels above5/255 RGB, maximum deltas27/7.
This new, uncommitted visual issue was fixed before delivery, not a shipped-product
finding. The initial seam probe ignored negative delays and sampled mid-cycle;
the retained delay-adjusted checks above supersede that probe.

The first general reversal harness required equal matrices in two separate CDP
calls and failed. It now compares before/after in the same browser task, waits
for the actual committed destination and verifies root/sun identity. No scene
transition code was changed to satisfy that measurement. The earlier failure
and script remain in the raw folder; the committed-phase result is in the JSON.

## Frontend and limits

[Raw narrow frontend receipt](frontend-checks.txt): seven tests, typecheck, scoped
ESLint/Biome and Vite build. The new persistence/depth regression was actually
[run on the old component and failed](regression-before.txt), then passed after
implementation. No full app/native test claim. Production selectors, dev HTML
and all 10 baked texture hashes are absent from the production output; the initial
bundle grep mistakenly matched existing locale `scenePreview` keys, not a scene
component leak. Assets and control-token values are unchanged.

The locale scanner exits0; active frontend en/zh 1118 keys have no missing/unused
keys. Overall 6820 missing/468 unused and one missing-source legacy/backend item
remain. No locale edits or globally-clean claim.

Raw reproducibility scripts, PNG sequences, stage traces, initial failed controls
and terminal output: `/tmp/tono-depth-20261004/`. Older evidence is retained.
Windows/WebView2, low-end/RDP, native visibility/occlusion, real connection feed
and future home glass-over-motion performance remain **unrun/unimplemented**.
The preview dock is a synthetic test control; final home belongs to later drafts.
