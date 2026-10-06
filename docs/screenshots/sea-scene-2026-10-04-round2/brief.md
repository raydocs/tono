# Tono Windows UI — round 2 brief (2026-10-04)

For the agent continuing PR #1375 (`raydocs/feat-sea-scene-pr1`, head `a83bfd42` when this was written).
Read `HANDOFF.md` in this folder and the repo `AGENTS.md` first; every limit there still applies (0.0.75, draft
PRs, no auto-merge on UI, `SESSION_STATE.md`, one changelog fragment per delivery, MacBook runs no native
builds, reply to the owner in Chinese, code and PR text in English).

This brief has three parts. **Part A** finishes the scene inside PR #1375. **Part B** is PR 2: the home screen
on the scene. **Part C** is PR 3: the top navigation bar and the frameless window, stacked on PR 2. Do A first;
B needs A11.

Reference images are in `round-2/`. They are mocks injected over the live preview (`home.mjs`), not app code.
Their copy is placeholder; the real copy is in §B4.

| File | Shows |
|---|---|
| `round-2/home-states.png` | The six home states at 920×600 (single files: `home-<state>-920.png`) |
| `round-2/home-min.png` | Failed and details sheet at 860×540 |
| `round-2/dock-compare.png` | The old bar against the two options the owner was shown |
| `round-2/scene-closeups-a83bfd42.png` | 2× crops of the scene at `a83bfd42` (connected, connecting / idle, failed) |
| `round-2/home.mjs` | The CSS of the mock: sizes, materials, colours |

## What the owner has decided

- 2026-10-04: the full-width bottom bar goes ("下面这个框有点丑"). The owner took my recommendation: **no bar; the
  action and the node sit under the title** (option 1 in `dock-compare.png`).
- Earlier: frameless, full-bleed window with Windows controls at the top right (handoff §7 question 4).
- 2026-10-04, after seeing `home-states.png` ("按你推荐的来"): **navigation is the top capsule, not the sidebar**
  (handoff §7 question 3). The same answer accepts my two calls in B5 and B6: the step list is collapsed
  during a clean connect, and the numbers live behind a details sheet. Record all three in `docs/decisions/`
  as owner decisions with that quote and date.
- Not decided: `protectedOffline` look, light theme, tray flyout size, connected sky colour, the moon, app icon
  assets. §D lists the default to build for each.

---

## Part A — scene work left (PR #1375, still the isolated preview)

Rules as before: transform and opacity only, baked textures, every loop carries `.sea-loop`, static fallbacks
unchanged, sunset and sunrise brightness stay monotonic. Re-measure brightness and pacing after each item and
say which numbers moved.

Measured at `a83bfd42` (MacBook, headless Chrome): sunset 73.1 → 26.9, largest 300 ms step 6.8; rAF 60 fps,
p95 16.7 ms; water pixels changing between two frames 12–20 % (was 5 %); **sky 0 % in every phase**; first
screenshots after a phase change took 200–340 ms (was under 10 ms).

Faults to fix:

- **A1. Failed: a diagonal light streak under the sun** (about x 600, y 345 at 920×600) and no wave reflection,
  only a red glow. It looks like the arrival sweep or afterglow layer left visible. Remove the streak and give
  the sliver a short, dim, red rippled reflection.
- **A2. Clouds over the sun are dark olive smears on the disc**, worst in `connecting`. A cloud in front of the
  sun is lit: warm, lighter than the sky clouds, low contrast. Or keep clouds off the disc.
- **A3. Connected glitter path is too faint.** Put a soft light column under the specks (widest at the
  horizon, gone by 70 % of the water height) and raise speck brightness in the first 80 px.
- **A4. Connecting reflection is dim and muddy.** Raise brightness in the first 60 px below the horizon. Keep
  the feathered outline.
- **A5. Swell lines read as scan lines in the darkest water** (bottom 100 px). Fade them with depth.
- **A6. Leftovers from the first list:** the horizon is still a hard full-width line (make it a 12–20 px haze
  band, bright only near the sun); the sun edge is still razor sharp (1–2 px feather, wider second glow); the
  crescent edge is jagged (SVG path or mask); idle water keeps a red patch with no light source (fade it or
  make it cool).

Life in the sky (nothing there moves today):

- **A7. Sun glow breathing** in `connected`: 7–8 s, opacity 0.9 ↔ 1, scale 1 ↔ 1.03.
- **A8. Clouds cross the sky**: one direction, 90–140 s per pass, two or three bands at different speeds.
- **A9. Stars**: three sizes and brightness tiers, slight warm and cool tints, twinkle periods 3–9 s on about a
  third of them, count scaled with window area. One shooting star every 40–90 s in `idle` only (one-shot,
  about 700 ms, never during a transition).
- **A10. Failed: the sun bobs on the horizon** (±3 px, about 5 s) with a slow ember pulse in the red glow.

Choreography and scale:

- **A11. Progress input.** Add an optional `progress?: number` (0–1) to `SeaScene`, used only in `connecting`:
  sun offset `205px − 150px × progress` (0 → a sliver, 1 → almost clear of the horizon), mirror matched, 900 ms
  per change with the sun easing. Without the prop keep today's 125 px. Brightness must not fall as progress
  rises. The scene never advances by itself.
- **A12. Linger at the horizon.** In the sunset the disc is gone by 2.4 s of 4.6 s. Use a `linear()` easing
  that slows while the disc crosses the horizon. Re-measure the brightness curve.
- **A13. Large windows.** Sun and glow scale with height, about `clamp(190px, 26vh, 300px)`, travel distances
  with them. Check 1920×1080 and 2560×1440.
- **A14. Capture latency.** Find which new masked layer made the first frames after a phase change slow, and
  report compositor cost in a Chrome trace. This is the item most likely to hurt on Windows.

Optional, only after the above: pointer parallax (sun ±4 px, stars ±2 px, clouds ±6 px, water ±8 px, damped,
only while the pointer moves, off under reduced motion).

---

## Part B — the home screen on the scene (PR 2, draft, behind a default-off switch)

### B1. Principle

One sentence and one action. The customer who prompted this said 0.0.74 was "不如之前的简洁, 逻辑有点混乱". Today the
overview stacks a pill, a hint, a progress card, hints, an error box, a node card, an AI traffic card and three
stat cards in one centred column (`src/pages/tono/dashboard.tsx:770`).

Nothing is deleted. Every element and every handler stays; they move into three layers:

1. **Always visible:** state title, one sentence, the action, the node.
2. **Attention stack:** only things the user must act on. Empty most of the time.
3. **Details:** numbers. One quiet line at the bottom, a sheet on demand.

Handlers, status reads, error classification, retry ownership and the release dialog stay as they are in
`dashboard.tsx`. This PR changes layout and styling only.

### B2. Layout (920×600 reference; see `home-states.png`)

- `SeaScene` fills the page's content area behind everything.
- **Left column:** `left: 56px; top: 22%; width: min(48%, 440px)`, a flex column. It never overlaps the sun
  (sun centre at 67.39 % of the width, radius 95 px).
  - Title: 64 px, weight 300, line-height 1.1, tracking 0.02em. Titles longer than four CJK characters or 12
    Latin characters use 48 px.
  - Sentence: 15 px, line-height 1.55, opacity 0.9, `margin-top: 10px`, max-width 400 px.
  - Connecting only: step dots, `margin-top: 14px`. 6 px dots, 7 px gap; done `#FFD9A0`, current `#FFF3D4` with
    a soft glow, pending white at 26 %. One dot per key in `CONNECT_STAGE_LABEL_KEYS`.
  - Action row: `margin-top: 22px; gap: 12px; flex-wrap: wrap`.
    - Action pill: 48 px high, padding 0 32 px, radius 999, 15 px, weight 500, tracking 0.04em.
    - Node chip: 48 px high, padding 0 18 px 0 16 px, radius 999: status dot (8 px), node name (15 px), city
      and delay (13 px, 64 %), chevron. It opens `/servers`.
  - Attention stack: `margin-top: 16px; gap: 10px`, full column width. Cards: radius 18, padding 14 × 16,
    13 px text, 32 px buttons. If it is taller than the space left, it scrolls inside itself; it never covers
    the action row.
- **Telemetry line:** `left: 56px; right: 56px; bottom: 26px`, 13 px, tabular numbers, opacity 0.82. Connected
  only. "详情" at the right end opens the sheet.
- **Details sheet:** `left: 40px; right: 40px; bottom: 22px`, radius 26, padding 18 × 20 × 20, four tiles in a
  grid (radius 16). It slides up over the water and leaves the title and action row visible. Esc, the chevron
  and a click outside close it.
- Minimum window 860×540 must fit the tallest case, failed with one attention card (`home-min.png`).
- Structural layout inline, as `tono-layout.tsx` and `dashboard.tsx:771` already require.

### B3. Materials

Glass only on controls, never on the text block.

| Where | Material |
|---|---|
| Quiet pill and chip over a bright or red sky (`connected`, `connecting`, `failed`, `protectedOffline`) | Smoked: `linear-gradient(180deg, rgba(40,16,14,.34), rgba(40,16,14,.46))`, `blur(26px) saturate(115%)`, `inset 0 1px 0 rgba(255,235,210,.28)` |
| Quiet pill and chip at night (`idle`) | Cool: `linear-gradient(180deg, rgba(190,202,255,.14), rgba(150,160,220,.06))`, `blur(26px) saturate(160%)`, `inset 0 1px 0 rgba(255,255,255,.24)` |
| Attention cards, details sheet | Panel: `linear-gradient(180deg, rgba(26,16,18,.56), rgba(16,10,14,.66))`, `blur(34px) saturate(140%)`, `inset 0 1px 0 rgba(255,235,220,.20)` |
| Primary action | `linear-gradient(180deg, #FFE9C4, #FFB877 60%, #FF9E63)`, text `#1A0F0A`, `0 10px 30px -8px rgba(255,150,80,.55)` |

Do not put light glass with high saturation over the bright or red sky: it turns hot orange or pink (I made
that mistake in the first mock).

**Blur over a moving scene costs every frame.** `tono-layout.tsx` already drops glass while connecting and
disconnecting (`tono-root--transacting`) because a blurred surface over anything animating made WebView2
re-blur the region at 60 Hz and froze a GPU-less machine. The new controls sit on a scene that always moves.
So: keep blurred surfaces small (pills, chip, cards; never a full-width or full-height blur), keep honouring
`tono-root--transacting` (during it these surfaces use the opaque fallback), and include the home page with the
sheet open in the Chrome trace. No full 1 px outline on any of these; one top highlight is enough. Text
`#F6F2EC`. Reduced transparency and missing `backdrop-filter`: the same shapes, opaque `#1D1917`.

### B4. States

`phase` is what `SeaScene` receives. Copy uses existing keys wherever one exists. Keys written without a prefix are under `tono.dashboard`.

| App state | `phase` | Title | Sentence | Action (existing handler) | Second control |
|---|---|---|---|---|---|
| `connected` **and** `hasLiveProtection(status)` | `connected` | `tono.pill.title.connected` | existing `connectHint` (`taglineConnected` or `directSkipped`) | 断开, quiet (`handleDisconnect`) | node chip, dot lit |
| `connected` without live protection | `failed` | `tono.pill.title.protectionUnknown` | `tono.progress.protectionUnknownBody` | as today | as today |
| `connecting` | `connecting`, with `progress` | `tono.pill.title.connecting` | current stage label (`CONNECT_STAGE_LABEL_KEYS[status.stage]`), fallback `taglineConnecting` | 取消连接, quiet (`cancelConnecting`; keeps the `protectionBlocked → requestRelease` branch at `dashboard.tsx:925`) | node chip |
| `disconnecting` | `idle` | `tono.pill.title.disconnecting` | `tono.pill.subtitle.restoringAccess` | disabled | node chip |
| `notConnected`, nothing failed | `idle` | new `tono.home.title.idle` (未连接 / Not connected) | `taglineIdle` | 连接, primary (`handleConnect`) | node chip; with no server: `pickServer` |
| `notConnected` after a failed connect (released failure, or `actionError.retry === 'connect'`) | `failed` | new `tono.home.title.failed` (没连上 / Couldn't connect) | `tono.progress.releasedFailureBody` | 重试, primary (`retryFailedAction`) | node chip |
| `protectedOffline` | `failed` | `tono.pill.title.protectedOffline`, or `protectionUnknown` when `!protectionConfirmed` | `protectedOfflineDescription`, or `protectionUnknownBody` | 立即重试, primary (`handleRetryNow`) | 恢复网络, quiet (`requestRelease`); the chip moves into the attention card as "选择其他线路" |

`progress` = index of `status.stage` in `CONNECT_STAGE_LABEL_KEYS` ÷ number of keys; unknown stage → omit the
prop. When a retry restarts the stages the sun goes back down. That is intended.

Start the sunset on `disconnecting`, not when `notConnected` arrives.

**Protection semantics (a mistake here is a major finding):**

- The sunny scene appears only for `uiState === 'connected' && hasLiveProtection(status)`.
- "原来的网络仍然可用" appears only when the barrier is released. Never in `protectedOffline`.
- `protectedOffline` keeps every action it has today (retry now, restore, switch route, backup channel, copy
  details, countdown). `ConnectProgressCard` owns them; do not re-implement them.

### B5. Attention stack: what goes in, in this order

Render all that apply; do not suppress a lower one because a higher one is showing.

1. `updateIncomplete` notice with its Disconnect button (`dashboard.tsx:807`)
2. `killSwitch.last_error` (`:842`)
3. `ConnectProgressCard` when it shows a failure, a retry or `protectedOffline` (`:940`)
4. The action error box with Retry, Copy details, `SupportReportAction`, switch route, `OpenDnsSettingsButton`
   (`:969`)
5. `catalogRequiresChoice` (`:787`)
6. `UnstableRouteHint` (`:959`)
7. `EncryptedDnsHint` (`:947`)

During a clean `connecting` (no error, `retryAttempt === 0`) the title, the stage sentence, the dots and the
sun carry the progress. `ConnectProgressCard`'s step list is then collapsed behind a "查看步骤" disclosure inside
the stack, and opens by itself on an error or a retry. If an existing test requires the list to be visible
during a clean connect, keep it visible and say so in the PR; do not edit the test.

Restyle these to the panel material. Keep their test ids, roles and conditions.

### B6. Details

- **Telemetry line** (connected only): `↓ rate · ↑ rate · 本次 total · AI 今天 total`, from the values the stat grid
  and `AiTrafficCard` already compute. Before the first traffic frame, show the existing `reading` or
  `telemetryFailed` text, never `0 B/s`.
- **Sheet:** exit (`ActiveNodeCard`: name, exit org and location, delays, Claude home), live traffic, AI
  traffic, node pool. Same data, same conditions.
- **`AiTrafficCard` must stay mounted while the home page is mounted, sheet open or closed.** It accumulates
  only while mounted (`tono.dashboard.aiTraffic.note`: "在总览页打开时累计"). Hide the closed sheet visually; do not
  unmount its content.
- `PageHeader` ("总览 / 云端保护") is not shown on this page; the state title replaces it.

### B7. Motion of the interface layer

Control timings stay on the existing tokens in `tokens/motion.css`; ambient tokens are for the scene only.

- Title and sentence: cross-fade 240 ms, new text rises 8 px. Text changes on the same frame as the state.
- Action pill: label swap with the same cross-fade; background 220 ms. Press feedback on pointer-down:
  `scale(0.97)`, 100 ms.
- Attention card enter: opacity and 8 px rise, 260 ms; exit 160 ms. No layout jump in the action row.
- Sheet: opens from the bottom edge and closes the same way. It must be interruptible; a spring with no bounce,
  about 0.35 s, is fine.
- Reduced motion: cross-fades only.

### B8. Accessibility

- `SeaScene` stays `aria-hidden`. The title is the page `h1` with `aria-live="polite"`.
- The sentence over the bright connected sky must reach 4.5:1. Use a soft text shadow or a local scrim under
  the column, not heavier type. Measure it and report the ratio.
- Real `<button>` and `<a>` elements, visible focus ring (`#FFE2B0`, 2 px, 3 px offset), tab order: action,
  node, attention stack, details.
- The sheet traps focus while open and returns it to "详情".

### B9. Switch, theme and navigation

- **Default off.** A local preference (same pattern as the glass setting in `tono-ui/theme.ts`) selects the new
  home; the current overview stays the default and its tests stay untouched. Say in the PR how to turn it on.
- **Theme:** the new home is dark in both app themes (provisional, §D).
- **Navigation:** render inside whatever content area the shell gives. The final look needs Part C. Until it
  lands the page sits beside today's 200 px sidebar, where the column is narrower and the action row wraps;
  that must not break, and it does not need to look final. Do not change the shell, the sidebar, window
  decorations or `src-tauri` in this PR.

### B10. i18n

New keys, `zh` and `en` only: `tono.home.title.idle`, `tono.home.title.failed`, `tono.home.details`,
`tono.home.showSteps`, and the telemetry labels if no existing key fits. Run `pnpm i18n:types` and
`pnpm i18n:check`. Do not rename or reword existing keys.

### B11. Tests (one per behaviour, no tables)

1. `connected` without live protection does not render `data-phase="connected"`.
2. `AiTrafficCard` stays mounted with the sheet closed.
3. `protectedOffline` renders the restore and retry actions and not the released-failure sentence.

Existing tests pass unchanged.

### B12. Out of scope

Lines page, tray flyout, logo and icon assets, shell and navigation (Part C), window decorations, macOS, light
theme, any routing, protection, helper or `src-tauri` code.

---

## Part C — top bar and frameless window (PR 3, draft, stacked on PR 2)

The owner chose the top capsule and, earlier, the frameless full-bleed window. Both change the shell
(`src/tono-ui/tono-layout.tsx`), so they ship together and apart from the home page. This PR touches
`src-tauri`; `windows-ci` verifies it and real-hardware checks are required before the owner merges.

### C1. The bar (see the top of every frame in `home-states.png`)

- 48 px high, full width, transparent, above the page ground. The bar is the drag region
  (`data-tauri-drag-region`); its interactive children are not.
- **Left:** the existing `TonoLogo` lockup, `padding-left: 18px`. The new sun mark in the mocks is the logo PR
  (handoff §8 item 5), not this one.
- **Centre:** the navigation capsule, centred on the window. Height 34 px, radius 999, padding 0 4 px, gap
  2 px. Items: 26 px high, padding 0 15 px, 13 px, tracking 0.02em, opacity 0.72. Current item: opacity 1,
  `rgba(255,255,255,.16)` fill with a top highlight. Material: the cool glass of B3 (the top 48 px of the sky
  is dark in every phase).
- **Right:** the existing `WindowControls`, 46 × 32 px each, flush to the top right corner.
- If logo, capsule and controls do not fit (long locale, 860 px), the capsule aligns left after the logo
  instead of the centre. Nothing wraps or truncates.

### C2. Navigation content

- All six routes of `src/pages/_navigation-meta.ts`, in their current order, with their current
  `tono.nav.*` labels. The mock labels differ; do not relabel in this PR.
- A `<nav>` of real links, `aria-current="page"` on the current one, same focus ring as B8.
- The login and tray routes have no bar content beyond what they show today.
- `TonoSidebar` shows the app version. Keep it reachable: move it to Settings if it is not already shown
  there. Do not drop it.

### C3. Pages under the bar

- **Home:** the scene is full-bleed under the bar; B2 applies with the full window width.
- **Other pages** (activity, nodes, account, support, settings): unchanged components, themes and
  `MeshBackground`. Their content sits in a centred column, `max-width: 760px`, starting below the bar. They
  are not redesigned here.
- `ServicePrereqBanner` and `ProtectedOfflineBanner` stay where `tono-layout.tsx` mounts them, below the bar.
- On light-theme pages the capsule uses the light tokens the sidebar uses today; do not show white text on a
  light ground.

### C4. Window

- Frameless on Windows. `tono-layout.tsx` already has the `decorated === false` path (`WindowResizeHandles`,
  `WindowControls`); the default is `DEFAULT_DECORATIONS` in `src-tauri/src/utils/resolve/window.rs`.
- Native behaviour must survive: drag, double-click to maximise, edge and corner resize, minimum size
  860×540, Win+arrow snapping, the Windows 11 snap layouts, correct maximised bounds on a second monitor and
  at 125 % and 150 % scaling. The owner asked for this to be qualified on hardware.

### C5. Switch

One default-off switch turns on the whole new look: the bar, the frameless window and the new home. With it
off, the app is pixel-identical to `main`, native title bar and sidebar included. Say in the PR how the switch
applies the decoration change (at start-up or live).

### C6. Test and evidence

- One vitest: with the switch on, the layout renders the bar with six links and no sidebar; off, the sidebar.
- Acceptance screenshots for B4 are taken on this branch, because this is the final look.
- Hardware list for C4, each item run or reported as not run.

### C7. Out of scope

Redesign of the other pages, the lines page on the scene, tray flyout, logo and icon assets, macOS.

---

## D. Open owner decisions and the default to build

| Question | Build this until the owner answers |
|---|---|
| `protectedOffline` look | B4: failed scene, existing copy and actions |
| Light theme | New home always dark |
| Tray flyout size | Unchanged; not in this round |
| Connected sky colour (brown now) | Unchanged |
| Moon | Keep |
| Idle title "未连接" replacing "待机" on this page | Use "未连接" (the owner has seen it in every mock); the old key stays for the tray |
| App icon, `.ico`, installer art, the new mark in the bar | Unchanged; existing `TonoLogo` |
| Look of the other pages under the new bar | C3: unchanged, centred column |

## E. Acceptance

Part A:

- [ ] A1–A6 fixed, shown in 2× crops beside `scene-closeups-a83bfd42.png`.
- [ ] Sky pixels changing between two steady frames is above 0 in `connected` and `idle`; state the numbers.
- [ ] Sunset and sunrise brightness monotonic, no 300 ms step above 8; the curve after A12 is attached.
- [ ] `progress` 0 → 1 in nine steps films as a steady climb; brightness does not fall.
- [ ] rAF pacing and a Chrome trace after A7–A10; first-frame capture latency explained (A14).
- [ ] 1920×1080 and 2560×1440 screenshots after A13.

Part B:

- [ ] Screenshots of the seven rows of B4 at 860×540, 920×600 and maximised, switch on, beside
      `home-states.png`. Final ones on the Part C branch; one on the Part B branch showing the sidebar case
      does not break.
- [ ] Every element listed in B5 and B6 is reachable, with the same conditions as today.
- [ ] Protection semantics of B4 hold; tests 1–3 pass; existing tests unchanged.
- [ ] Title and action change within 250 ms of the state change; reversing mid-transition does not jump.
- [ ] Contrast of the sentence over the connected sky reported.
- [ ] Switch off: the overview is pixel-identical to `main`.
- [ ] `npx tsc --noEmit`, `npx vitest run <touched tests>`, `npx eslint --max-warnings=0 <files>`,
      `npx biome check <files>`, `npx vite build`, `pnpm i18n:check` from `apps/windows/app`.
- [ ] Chrome trace of the home page with the sheet open: no full-window blur, cost of the blurred controls
      over the moving scene reported.
- [ ] Real Windows / WebView2: run, or reported as not run.

Part C:

- [ ] Bar matches the mocks at 860, 920 and maximised widths, in `zh` and `en`.
- [ ] Every route reachable; app version still reachable; banners still shown on the pages that show them now.
- [ ] Other pages: same content as `main`, centred, readable in both themes.
- [ ] C4 hardware list, each item run or reported as not run. `windows-ci` green on the head SHA.
- [ ] Switch off: pixel-identical to `main`.

## F. What I verified and what I did not

Verified on a MacBook in headless Chrome: the scene films and measurements above; the six mock states at
920×600; failed and sheet at 860×540.

Not verified: anything on Windows; frameless window behaviour; the other pages under the new bar; the bar in
the light theme or in English; the mocks with the real sidebar; real data in the attention stack (the mock
shows one card); whether existing tests assert the step list during a clean connect.
