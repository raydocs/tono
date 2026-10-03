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
- Bake cross-wave ripple masks and white grain once using the stdlib script.
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
- Document visibility pauses loops without restarting them. `paused` also selects
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

Frontend: narrow vitest (one test), TypeScript, scoped ESLint/Biome, Vite build
and i18n type generation passed. The locale scanner exits 0 but reports inactive
locale gaps and legacy backend unused/missing-source keys: **not a globally clean
i18n result**. English/Chinese frontend keys are clean; no bulk locale cleanup.

## Not verified / not implemented

Real Windows/WebView2 frame pacing, low-end or remote-desktop hardware, native
visibility/occlusion and real Windows maximisation: **not run** on this MacBook.
The 1920×1080 images are a simulated large viewport, not Windows device evidence.
No native builds, Tauri, packaging, merge, deployment or customer publish.

Protection mapping, all real dashboard cards, light theme, navigation, chrome,
tray sizing and branded icons are later PRs. Before PR 2 ask the owner section 7
questions 1–5 in one numbered message; the provisional choices remain in
[decision 055](decisions/055-2026-10-03-windows-sea-scene-preview.md).
