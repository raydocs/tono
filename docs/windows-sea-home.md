# Windows SeaHome — opt-in home (ROUND-3 PR 2)

Ownership: [SHIP_PLAN](SHIP_PLAN.md), Windows 0.0.75 UI work. Stacked on draft
[#1375](https://github.com/raydocs/tono/pull/1375). Source only: no merge, native
package, deployment or publication. The [owner decisions](decisions/069-2026-10-05-windows-round3-appearance.md)
remain provisional. No automatic external review was requested or performed.

## Enable and reproduce

The device-local `tono-ui-preferences.newAppearance` defaults to `false`. This
PR changes only the home; the top bar and frameless shell belong to PR 3. The
settings switch and motion row arrive in PR 9. Until then, in app DevTools:

```js
const key = 'tono-ui-preferences';
localStorage.setItem(key, JSON.stringify({
  ...JSON.parse(localStorage.getItem(key) || '{}'), newAppearance: true
}));
window.dispatchEvent(new Event('tono-ui-preferences-changed'));
// Repeat with false to restore the existing overview.
```

For safe browser inspection, from `apps/windows/app`:

```sh
pnpm exec vite --config vite.home-preview.config.mts
# http://127.0.0.1:3012/?lang=zh&quality=full&scenario=connected
# scenario=idle|connecting|connected|disconnecting|failed|protectedOffline|unknown
# &slow holds a synthetic connect; &long exercises long line names
# &scheduled=15 sets a stable protectedOffline retry deadline
# lang=en; theme=light; quality=auto|full|lite|static
# &full removes the 200px sidebar footprint for isolated home inspection
# &appearance=old renders the unchanged overview in the same fixture shell
# &diagnostics shows the bounded probe readout; Measure 3 s explicitly re-arms it
```

The separate development entry renders the **actual DashboardPage, SeaScene,
status-push hook and SWR queries**. It replaces native IO, window APIs and traffic
feeds with deterministic synthetic data. Connect/disconnect and line selection
in it do not change the host network. Its sidebar is a footprint placeholder,
not the real shell. It is not an input to the production build; the opt-in home
itself is a production app component. Do not confuse it with the offline S0 scene
ZIP, which remains a PR 1 artifact.

## Behavior and preserved contracts

- The sunny scene requires `uiState === 'connected' && hasLiveProtection(status)`.
  Connected without evidence and protected-but-offline use the failed scene;
  released failure alone uses the existing released-failure sentence. Start the
  sunset on `disconnecting`. Stage index divided by stage count is caller progress;
  unknown stages omit it. No inferred progress, optimistic state or extra FSM.
- Phase, state title and action label share the authoritative status React commit.
  Existing native connect admission emits Connecting before its stages; this is
  **not** a claim that asynchronous IPC completes synchronously inside `onclick`.
  Pointer-down has immediate 0.97 scale feedback. Existing connect, cancellation,
  retry, restore confirmation, backup, diagnostic copy and support handlers stay.
  Retry/restore/line selection live only under the title. The explanation card has
  no duplicate primary actions or failure sentence. Secondary copy/upload/backup/
  DNS text buttons live behind its default-closed Technical details disclosure;
  there is no third action row above the card (owner re-check R2). The protected-offline sentence and recovery heading use
  the same progress deadline/countdown, never a claim of an unscheduled retry.
- The line chip opens a collision-clamped 320px dialog: recommended, favorite and
  recent lines, at most five distinct line rows plus All lines. It opens downward
  whenever at least200px remain below the chip, scrolling inside; it flips up only
  with less than200px below and more room above (R1). Selection has the
  existing Lines-page availability guard, `tonoSelectServer` and
  `connectIfIdleAfterSelection` dispatch/refresh/toast path. Repeated dispatch is
  locked. No new recommendation policy or automatic failover. Chip/rows share
  codename-first localized city naming. Selected rows show a check and the selected
  exit measurement; other rows use an existing cached measurement or a dash.
- At 8s show the existing stage sentence plus the slow explanation; at 20s show
  elapsed seconds and a manual picker link. Constants live in `home-timing.ts`.
  These timers never switch lines. Clean steps are collapsed only for the new
  appearance; errors and retries open them. Collapsed clean steps are text-only,
  not a dark card. Home titles omit the ellipsis; slow-stage composition trims it
  before its suffix. Existing test IDs/actions remain.
- Details preserve the existing exit, live traffic, AI tally and pool data.
  Details use one vertical sheet scroll area and non-shrinking cards. The legacy
  card layout/cosmetic cutoff at the sheet edge is explicitly deferred to the
  PR4 foundation work (owner re-check R3), not a current restyling acceptance.
  AiTrafficCard stays mounted in the closed, inert sheet. The telemetry AI total
  comes from that same tally, with scope matching before display. Before a traffic
  frame, keep Reading/telemetry-failed rather than inventing zero rates.
- Protection minutes update once a minute in the same text span (no repeated
  entrance). The first-success window/tray hint is stored per device and disappears
  on the next home visit. Tab order, dialog focus trap, Esc/outside dismissal and
  return focus are local to home. Enter/Space operate only with no other control
  focused. SeaScene is decorative; the title is the polite live `h1`.

## Interface motion and materials

State text cross-fades in 240ms with an 8px rise. Pill surfaces are prepainted
pseudo-layers cross-faded using the existing 220ms control token; gradients and
filters are not animated. Attention enters over 260ms and leaves inert over
160ms. The details sheet reverses its CSS transform/opacity transition without
waiting for an animation lock. Reduced motion keeps fades, removes travel and
selects the scene's Static tier.

The dark-only home has local tokens and a continuous feathered left-side ink wash,
not heavier text or a blurred text card. The intermediate sidebar has a 32px inset
at narrow canvas widths; the final full-bleed shell is PR 3. The wash feathers
over a fixed160px in every tier, not a hard Lite edge. At narrow widths, failed/
protected-offline columns use the available width and start at16% instead of22%,
so English titles/actions cannot consume the explanation card. Attention scrolls
inside its available space. Measured sheet height keeps the action row uncovered.

Glass is limited to small controls, popover and attention cards. Connecting,
disconnecting, `tono-root--transacting`, Lite, reduced transparency and missing
backdrop support use smoked/opaque controls. **The wide details sheet and its tiles
are solid in every tier**: B3's small-blur constraint takes precedence over the
table's blanket panel blur. Reduced transparency changes materials only, not
scene motion. Owner review S2 exposes one narrow S0 CSS exception: a prepainted
60px diffuse gold field on the existing light column, below the horizon only.
Its existing daylight/path/red opacity envelopes apply; no new moving layer,
filter, loop, texture or timing/control-token change. The original3f9 S0 ZIP is
historical and does not contain this correction.

## Verification and limitations

[Initial d2dd8f21 evidence](screenshots/sea-home-2026-10-05/README.md) is retained;
[owner-review correction evidence](screenshots/sea-home-2026-10-05/review-corrections/README.md)
is the historical H1–H12 receipt. [819b8588 re-check evidence](screenshots/sea-home-2026-10-05/recheck-819b8588/README.md)
is the latest receipt for R1–R4. The new placement and revised secondary-tools
regressions fail before the fix and pass after; current narrow home/progress
checks pass53tests/2files. The earlier full frontend run passed351tests/49files;
it is not represented as a current full-suite rerun. Typecheck/index79/baseline79, scoped
ESLint/Biome, frontend build and locale generation/check pass. Existing en/zh
values are unchanged;30 new `home.*` keys each, generated1158keys. The scanner
still reports unrelated inactive-locale/legacy-backend gaps, not global cleanliness.
Current FPS is reported separately in the correction evidence; older60fps
captures are not a current performance pass or a Windows qualification.

- Protected duration is a **GUI-observed lower bound**, keyed to the current
  account/controller generation and retained across home visits. Current native
  status/diagnostics expose no connected-at timestamp; stage `totalElapsedMs` is
  not tunnel uptime. Opening home for the first time after a long connection or
  restarting the GUI can display Just connected/under-report duration. This PR
  does not expand the native DTO or invent an uptime value.
- Recommendations reuse scoped/catalog-matched preferences and fresh recent
  success evidence. The Lines page's page-local TCP-test history is unavailable
  here. Missing recommendation/latency is honest empty content or a dash, not a
  fabricated reachable result. No mock's example numbers enter app logic.
- Screenshots/recording use MacBook headless Chrome with synthetic native IO.
  They are not a real VPN transaction, WebView2 performance qualification, native
  maximized window or the PR 3 final-shell acceptance images. Windows, weak/no-GPU
  hardware, RDP, native minimization and 125%/150% DPI remain **not run**.
- No native protection/connection/routing, existing Lines-page service, shell,
  sidebar, window decorations, tray, icons, dependencies or old strings changed.
  Default-off pixel comparison covers the connected overview fixture in both app
  themes, not every possible old-page state or native window.
