# SeaHome PR 2 evidence — 2026-10-05

This is the initial d2dd8f21 delivery. [Owner-review correction evidence](review-corrections/README.md)
is the current receipt; historical captures/failed controls below are retained.

Actual DashboardPage/SeaScene/ConnectProgressCard and status-push/SWR path,
**synthetic native IO/traffic**, MacBook M3 Pro, macOS26.5.2, headless Chrome.
Node26.10.0/pnpm10.33.0 locally; no toolchain/native builds. Baseline:
`3f9c19520ce0d5c40a3d9c6a5e4294b4edd74af2` (draft#1375).
[Final app input hashes](source-fingerprints.json) bind these captures/checks to
the implementation in this draft. The existing shell is represented by a 200px
footprint placeholder; `&full` is **isolated home**, not a completed frameless app.
[Reproduction and limitations](../../windows-sea-home.md).

## View

- [Connected isolated home](connected-final.png), [line picker](switch-final.png),
  [solid wide details](details-final.png), [slow connect/manual switch](slow-final.png).
- [Minimum 860×540, long English/light app theme picker](min-switch-final.png).
- Seven states, zh, 920×600 sidebar footprint:
  [idle](states/idle-920.png), [connecting](states/connecting-920.png),
  [connected](states/connected-920.png), [disconnecting](states/disconnecting-920.png),
  [released failure](states/failed-920.png), [protected offline](states/protectedOffline-920.png),
  [connected without live evidence](states/unknown-920.png).
- Minimum: [connected](states/connected-860.png), [failure](states/failed-860.png),
  [protected offline](states/protectedOffline-860.png).
  [Large 1920×1080 viewport](states/connected-1920.png), not a native maximized window.
  [All21 state/size geometry records](states/geometry.json): no JS exceptions or
  document horizontal overflow; only the three evidence-confirmed connected cases
  have the connected scene. All21 original PNGs are retained locally at
  `/tmp/tono-round3-20261005/pr2/states`; representative images are committed here.
- [11s connect→connected→disconnect movie](home-cycle.webp),
  [163 original native-timestamp JPEG frame samples](home-cycle-native-frames.zip),
  [timestamps/transaction checkpoints](film-timestamps.json). This is a real page
  recording with **simulated network transactions**, not a real VPN test. Every
  fourth compositor frame was requested; movie sample rate is not an FPS claim.

## Current checks

[20 browser checks](browser-checks.json) passed: anchored320px picker, short-window
collision handling, Esc/outside/focus return, sheet focus trap and action-row
clearance, manual8s/20s thresholds, no automatic selection, pointer-down0.97,
phase/title same authoritative commit, sunset before idle, Lite/connecting no
blur, reduced transparency preserves moving scene, reduced motion keeps240ms
text/160ms sheet fades while stopping scene travel.

Conservative paragraph contrast uses the entire measured rectangle, text hidden,
sRGB luminance and the actual `.94` text alpha, **without credit for text shadow**.
[Background/geometry](states/contrast-geometry.json), [ratios](contrast-sizes.json):
860×540 **6.65:1**, 920×600 **6.95:1**, 1920×1080 **13.68:1**.
The [background PNGs](states/contrast-860.png) (also `contrast-920.png`,
`contrast-1920.png`) retain the continuous column wash. Only child text is hidden
when a local pseudo wash exists; hiding the parent would invalidate that control.

Default-off, identical deterministic fixture inputs, actual baseline/current
DashboardPage and both themes: [pixel result](legacy-pixels.json),
[browser validity](legacy-control.json),
[dark baseline](legacy-dark-baseline.png)/[current](legacy-dark-current.png),
[light baseline](legacy-light-baseline.png)/[current](legacy-light-current.png).
Both RGB comparisons have **zero delta**. This covers the connected overview
fixture, not every old state/native window. Baseline source was copied from Git;
only relative import paths were remapped for the isolated control entry.

## Details-open steady traces (3s each)

[Raw summary](performance.json). Decompress each `.trace.json.gz` and load the JSON
in Chrome Performance. Full-connected has blur only on small quiet controls;
the pill's parent is unblurred and its `::before` carries the26px blur. The wide
details sheet is solid in every case.

| State/tier | FPS / p95 | Paint / Layout / RasterTask | Style events / CPU ms |
|---|---|---|---|
| [Connected Full](connected-full-sheet.trace.json.gz) |60.00 /16.8ms|0 /0 /1|183 /70.027|
| [Connecting Full](connecting-full-sheet.trace.json.gz) |60.00 /16.8ms|0 /0 /1|181 /50.726|
| [Connected Lite](connected-lite-sheet.trace.json.gz) |60.00 /16.8ms|0 /0 /1|182 /24.989|
| [Connecting Lite](connecting-lite-sheet.trace.json.gz) |60.00 /16.8ms|0 /0 /1|181 /29.131|

Each RasterTask costs0.074–0.240ms. **Not zero style/raster work**, not a Windows
GPU-less/WebView2 result and not proof that blur is safe on the owner's machine.

## Frontend verification

Final delivery checks after the accepted continuous wash:

```sh
cd apps/windows/app
pnpm typecheck
pnpm exec vitest run src/pages/tono/sea-home.test.tsx src/pages/tono/dashboard.test.tsx src/pages/tono/connect-progress.test.tsx src/pages/tono/servers.test.tsx src/tono-ui/SeaScene.test.tsx src/tono-ui/appearance-preferences.test.ts src/tono-ui/scene-quality-probe.test.ts src/tono-ui/AiTrafficCard.account-scope.test.tsx src/tono-ui/ai-traffic.test.ts
pnpm exec eslint --max-warnings=0 <14 touched TS/TSX/config files>
pnpm exec biome check <20 touched source/config/locale/generated files>
pnpm exec vite build
pnpm i18n:types
pnpm i18n:check
```

9 files/106 tests passed (13 new home regressions). Existing page tests are
unchanged. Full TypeScript and unchecked-index79/baseline79 passed; ESLint0
warnings, Biome20files/no fixes, build1.20s, generated1150 keys. Locale scanner
exits0; en/zh frontend unused/missing/extra/missingSource all0. Unrelated inactive
locales/legacy backend gaps remain. Existing en/zh values match baseline exactly;
22 new `home.*` keys each. No scene/texture/control-token/native/shell/selection
service diff. [Decisive terminal receipts](controls/pr2-tests-delivery.txt),
[typecheck](controls/pr2-typecheck-delivery.txt).

## Failing/rejected controls (not hidden)

- [Protection regression on old code](controls/pr2-before.txt) actually failed:
  no SeaScene existed, so expected failed received undefined. This proves the
  missing new mount contract, **not** an old sunny/protection leak.
- [Initial sidebar contrast](controls/contrast-sizes-pre-scrim.json) failed3.46/
  3.66:1. A [text-strip wash](controls/connected-rejected-strip.png) passed
  [7.22/7.37](controls/contrast-sizes-rejected-strip.json) but was rejected visually.
  Final continuous left-side wash passes without a dark text rectangle/heavier type.
- Initial reduced-motion cascade inherited a global1e-06s reset; scoped selectors
  fixed it to240ms/160ms fades. [After result](reduced-motion-after.json).
- First picker audit sampled its180ms growth at120ms; a second audit had a quoted
  selector syntax error. [First](controls/pr2-audit-first-failure.txt)/
  [second](controls/pr2-audit-second-fixture-failure.txt) instrumentation failures
  were fixed, not papered over with app logic.
- An initial baseline control had a missing Vite React preamble, rendering blank;
  its apparent pixel equality was invalid. [Invalid pixels](controls/legacy-pixels-invalid-control.json)
  and [exceptions](controls/legacy-control-preamble-failure.json) are retained.
  The accepted comparison above renders the real baseline/current page without exceptions.

Windows/Edge/WebView2, weak/no-GPU hardware, RDP, native minimization/occlusion,
125%/150% DPI and native frameless interactions: **not run**. No automatic
external review or merge acceptance is claimed. All drafts remain owner-gated.
