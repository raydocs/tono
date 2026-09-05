# Tono Clarity — desktop design and qualification

## Research and decisions

Public references consulted September 5, 2026. No Appllama/OAuth dependency,
downloaded competitor assets, UI kit or new runtime dependency.

- [Apple: Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): let native controls adapt; test accessibility settings; avoid overuse. Tono keeps macOS NavigationSplitView and its native material, rather than reproducing iOS tabs in a desktop window.
- [Apple HIG: Materials](https://developer.apple.com/design/human-interface-guidelines/materials): glass belongs to the functional/navigation layer, not the content layer. Tono removes content backdrop sampling; the welcome's two linked rings suggest a connection with a static optical edge, never a refracting text surface.
- [Microsoft: Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica): performance and opaque fallback are part of the material design. Tono's WebView implementation uses opaque content by default, not an imitation wallpaper sampler. No shader, continuous displacement loop, canvas, or GPU capability probe is required to get the low-cost version.
- [Linear: UI redesign](https://linear.app/now/how-we-redesigned-the-linear-ui): consistent chrome, alignment and navigation hierarchy reduce noise. Tono adopts the separation of navigation from work, not Linear's pixels, typeface, branding or app architecture.

## System

Tono's identity remains its own TO mark. Clarity replaces the frosted-form
composition with a desktop workspace: identity/story on the left, an immediately
usable task on the right. Under 800 CSS px the story compresses above the form;
the form and recovery actions always scroll rather than clipping.

| Role | Light | Dark |
| --- | --- | --- |
| Content ground | #F6F8FC with quiet blue tint | #141922 with quiet blue tint |
| Content card | #FFFFFF | #1B202B |
| Navigation ground | #EAF0F8 | #141922 |
| Welcome ground | #E4EBFA | #202B45 |
| Primary login action | #3658C9 / white text | #3658C9 / white text |
| Error text (web) | #B3261E | #FF9B96 |

The native and web implementations share these roles, not a cross-platform
widget abstraction. Windows uses Segoe UI and macOS uses the system font;
Chinese has native fallbacks. Scale: 4px spacing, 10px controls, 12/16/20px content
radii, 28px form heading, 13–14px body. The mark retains its color ramp; task
surfaces are single-accent. Text stays selectable where users need it.

Existing `GlassCard` and `data-tono-refined` names are kept as compatibility
boundaries, but their token source is replaced rather than adding a second
override layer. Semantic status green/orange/red meanings and latency thresholds
are unchanged. This does not rewrite the routing, VPN, billing or auth protocol.

## Journey and interaction contracts

1. **Email:** focused, labelled field; passwordless explanation; immediate
   button-local sending feedback. No animation hides the initial content.
2. **Inbox:** explicit step/title and instructions to return from the user's
   mail app, full email/sender, validity and resend cooldown. No `mailto:` button
   that misleadingly opens a composer instead of an inbox; no guessing a work
   account's provider or sending the email to a third-party URL.
3. **Verify:** one six-digit submission; request exclusion retained. Failed
   verification leaves instructions and email intact and restores code focus.
   Change-email keeps the address for correction, discards only the local
   challenge UI. macOS guards the reset against authenticated/busy/restore states.
4. **Workspace:** successful login replaces the login route. Windows defers
   six non-login page modules until navigation, with pending feedback in the
   sidebar; macOS allows the native sidebar toggle instead of forcing it open.
   Safety banners, retry, support and explicit restore-internet remain reachable.

Motion is feedback, not a loading prerequisite: 100–220ms existing press/state
transitions, no new perpetual animations. The old 500ms web root fade and macOS
entrance offset / forever-shimmer are removed. Web reduced-motion eliminates
spatial transitions; contrast/transparency modes remove filters and forced colors
uses system boundaries. macOS uses Reduce Motion and Reduce Transparency, removes
the extra full-window NSVisualEffectView, and delegates navigation material to
SwiftUI. Native status surfaces still require actual-system acceptance.

## Reproduction

From `apps/windows/app`:

```sh
pnpm typecheck
pnpm test
pnpm web:build
pnpm lint
pnpm format:check
pnpm exec vite --config tests/desktop-preview/vite.config.mts
```

The last command is a **component preview**, not a Tauri/VPN simulator. It mounts
the real LoginPage, sidebar and connect/card components with isolated fixture
aliases. Production builds never import those aliases. Routes: `/#/login`,
`/?theme=dark#/login`, `/?lang=zh#/login`, `/?slow#/login`,
`/?account=suspended#/login`, and `/#/` for the component gallery.
Only the synthetic code `123456` succeeds; another code demonstrates recovery.
No email, VPN or production API request is made. The gallery is not the real
dashboard's network state and must not be presented as a successful connection.

## Measured baseline

Baseline is unmodified `49bee9a`, extracted with `git archive`. Both builds use
the same installed toolchain and `vite build --manifest`. Traverse every entry's
static `imports` recursively, sum each unique emitted JS file once (including
the polyfill entry, excluding dynamic route imports):

| Initial JS | Before | After route splitting |
| --- | ---: | ---: |
| Raw bytes | 881,120 | 668,883 |
| Gzip bytes | 270,596 | 220,925 |

This is a 24.1% reduction in initial JS / 18.4% gzip, **not** a claim that the
entire download is the 337KB entry chunk, nor a measured native startup gain.
The dev preview's first cold paint included Vite compilation (9,920ms), so it is
not compared to a warm after capture as a speedup. Input-to-next-rAF samples in
the Chromium component flow were 0.2–12.9ms (four events, local synthetic network);
these are not production INP, Windows WebView2 startup or macOS frame-time data.
The welcome had one active backdrop filter before and zero after; zero idle web
animations after. Native code removes one full-window blur and one perpetual
logo animation; native GPU/energy savings are not measured in Linux.

## Qualification boundaries

- Full Windows web tests: 164 tests passed at the initial integration check;
  rerun after final changes. Typecheck and production build passed.
- Baseline full lint fails with six warnings on untouched main. The OTP guard
  now uses a ref instead of an extra state render, removing one warning.
  Remaining pre-existing warnings tracked in [#38](https://github.com/raydocs/tono/issues/38), not suppressed.
- Browser visual/axe checks cover both themes, code and rejected-code states,
  keyboard flow and reduced motion. Screenshot evidence is attached to the Amp
  delivery; the preview remains the reproducible review surface.
  Final Chromium axe runs: light rejected-code (33 passes), light standby and
  connected galleries, dark connected gallery, and forced-colors/reduced-motion
  gallery (24 passes each): zero violations and zero incomplete checks.
  The gallery's version label no longer compounds text alpha with opacity;
  the connection action uses a solid surface under its text. Loading, compact
  Chinese and both welcome themes were also captured and visually inspected.
  These are component checks, not a whole-application accessibility certification.
- macOS must compile and run TonoTests in macOS CI. Linux cannot render SwiftUI,
  validate VoiceOver, notarization, installed WebView2, WFP or the updater.
- [#17](https://github.com/raydocs/tono/issues/17) tracks installed-device acceptance,
  including 100/150/200% Windows scaling and macOS accessibility settings.
  [#26](https://github.com/raydocs/tono/issues/26) remains a stable-release gate.
  Secret inventory API returned 403; credentials are unknown, not proven absent.
  No stable release or feed promotion follows merely from a green UI build.
