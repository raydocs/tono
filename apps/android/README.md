# Tono mobile (Android) — sing-box client

`android/mobile` is the new user-testable Android client (`com.raydocs.tono.mobile`, debug package
`com.raydocs.tono.mobile.test`). It signs in to the existing Tono control plane, fetches the user's
exit catalog, generates a sing-box configuration from the desktop routing contract and runs it in
`VpnService` through the official sing-box mobile library (libbox). The legacy `android/app`
(mock / Mihomo internal track, cartoon UI) is untouched and kept as a future theme resource.

## UI (round 2, "horizon dock")

- Home shows only: state word, one status line (verified exits when connected, short reason
  otherwise), one primary capsule, the exit pill, and a Details handle. Route lanes, full reasons,
  routing summary and mode live in Details.
- The primary capsule is the only connection control: Connect / Retry / Allow VPN → Cancel (while
  preparing/connecting; a sunrise fill advances with the engine phase) → Disconnect with a live
  timer → Disconnecting (disabled). The sun in the scene climbs on the same phases. The previous
  slide switch was removed.
- Glass: surfaces redraw the scene behind them, blurred (RenderEffect, API 31+), with a smoked
  tint and a top-lit rim; below API 31 the tint is denser instead of faking blur.
- Brand: sun-on-the-horizon mark from raydocs/tono PR #1584 (`2cf98bbc9`, decision 095); adaptive
  launcher icon (+ themed monochrome), in-app tile/mark, splash ground `#0B0A12`, and status-bar
  glyphs from the desktop menu-bar/tray state family (filled sun only when verified connected).
- Haptics: context click on press, CONFIRM on arrival, REJECT on failure (API 30+). Reduced motion
  removes every infinite animation and jumps state changes.

Round 3 (after user feedback 6/10): exit countries are shown in the UI language (`JP` → 日本 /
Japan), Details is a glass pill and also opens with an upward flick on the dock, Settings copy is
shorter, and tokens/catalog use a module-local Keystore AES-GCM store (no dependency on the legacy
`android/security` module, so the client builds on its own).

Round 4 (Android-native surfaces and accessibility):
- **System surfaces.** A Quick Settings tile, a home-screen widget, and a notification when the
  tunnel ends without the user asking (with Retry). The ongoing notification shows the verified
  exits. All of them read one shared status that the engine writes (`surface/PublicStatus`: no
  tokens, e-mail or catalog) with a 30 s heartbeat and the boot count. A tunnel is shown only while
  that record is fresh, from this boot, and Android reports a VPN network. Otherwise the surface
  says *Status unknown* with the last known state and time.
- **Safe actions.** Tile and widget actions never get around sign-in, Android's VPN consent or the
  lock screen: those cases open the app. The engine re-checks the account and consent before it
  connects.
- **Consent explanation.** Before Android's VPN dialog, whenever consent is missing, a short sheet
  says what the dialog is, what Tono routes and how to stop it.
- **Accessibility and text size.** Every control is laid out at ≥ 48 dp. Home scrolls at the largest
  font size instead of squeezing the dock. The app follows Android's *Remove animations* live.
  Predictive back is enabled.
- **Glass.** The scene is recorded once per frame and blurred once (`BackdropHost`). Every glass
  surface draws its slice of that copy, instead of each surface composing and blurring its own copy
  of the scene.

Round 5 (after two independent reviews, `docs/agent-reports/2026-10-18-mobile-*` in raydocs/tono):
- Settings moved from the top-right corner into the dock, sharing one glass pill with Details; a
  screen reader now reads the state, the primary action and the exit before Settings.
- Shorter copy, aligned with iOS: one-line routing modes, "AI paused", no repeated route summary in
  Details, "家宽" without "Home", and the line name on Home only when two lines share a city.
- Motion: state words no longer cross-fade on top of each other; after a disconnect or failure the
  sun sets in 650 ms (was 1.8 s) so the sky follows the words.
- Glass: lighter smoke tint and a stronger top sheen so the blurred sea shows through the controls.
- The consent sheet carries the sun mark and is captured over Home; Apps keeps Done at the bottom
  and is captured after its list has loaded; every fixture screenshot carries a "FIXTURE · no
  tunnel" mark in the picture.
- Device tests run on two emulators side by side (`system` and `ui` halves), each with one retry on
  a fresh emulator; both halves must pass.

Round 6:
- **A real tunnel against local stand-ins.** Debug builds can be pointed at a local fixture control
  plane (`engine/LocalTestServer`). This is only allowed on the phone's own loopback over plain HTTP
  (CI forwards it with `adb reverse`), only through a file in app-private storage, and only in debug builds. The account is bound
  to the server it was made on, and every screen shows "Local test server · not Tono" while it is
  active. The pill sits in the status-bar band; Android hides anything wholly under the status bar
  from screen readers, so the same words also sit on a hairline node just below it, first in
  TalkBack's reading order (the tunnel test finds it the way TalkBack would). Catalog admission is unchanged. `scripts/local-tunnel/fixture-servers.py` runs the stand-in
  control plane, a VLESS Reality cloud exit and a SOCKS5 Home exit (the pinned sing-box CLI) on the
  CI host.
- **Keyboard, D-pad and switch access.** Focus shows a ring on every Home control and on the
  sign-in buttons; Enter acts.
- **Other screen shapes.** On a landscape phone, Home keeps a thumb-width column and the sun moves
  aside; sign-in centres its card. This is from JVM renders only: the CI emulator could not be
  turned to landscape (two attempts), so landscape is not verified on a device.
- **Copy.** A stopped hop is "paused" (暂停) everywhere: the status line, Details and the routing
  scope.
- **Fixture captures.** The fixture mark sits in the status-bar band, and fixture hosts draw edge to
  edge as the app does.

## Where it lives

`rw8/Tono-droid` (Amp) is the source; `scripts/export-android-monorepo.sh <raydocs/tono checkout>`
mirrors the mobile and routing modules, the sing-box pin and the routing scripts into
`raydocs/tono` as the self-contained Gradle build `apps/android` (paths and Gradle project names
drop the `android/` prefix: `:mobile`, `:routing`). In `raydocs/tono`,
`.github/workflows/android-ci.yml` rebuilds libbox from the pin, runs the JVM tests and lint,
uploads the debug-signed test APK as an Actions artifact (90 days) and runs the on-device evidence
on an Android 14 x86_64 emulator (KVM).

## Modules

| Path | Role |
| --- | --- |
| `android/routing` | Pure Kotlin: catalog YAML admission, desktop routing contract (generated), sing-box config generator, rule explainer. JVM-tested. |
| `android/mobile/engine` | `TonoVpnService` in the `:vpn` process: session, catalog, libbox lifecycle, probes, notification. Sole owner of tokens and the tunnel. |
| `android/mobile/ui` | Compose UI in the main process. Talks to the engine only through `ITonoEngine` (JSON snapshots/commands). |
| `supply-chain/sing-box` | Exact core pin, reproducible libbox build script, expected hash, provenance. |
| `scripts/routing` | Contract sync from the desktop repo, `sing-box check`, real-engine routing harness. |

## Build and install (test build only)

```bash
.agents/setup && source .agents/resume
supply-chain/sing-box/build-libbox.sh .amp/in/libbox-out       # ~25 min; verifies Go/NDK/source pins
cp .amp/in/libbox-out/libbox.aar android/mobile/libs/libbox.aar  # not committed (.gitignore)
./gradlew :android:mobile:assembleDebug                          # verifyLibbox checks the pinned SHA-256 first
adb install -r android/mobile/build/outputs/apk/debug/mobile-debug.apk
```

Signing: AGP's per-machine debug keystore (`~/.android/debug.keystore`), generated locally and
never committed or published. The APK is debuggable and test-only. Release variants of this module
are disabled; that is the delivery gate for this round (internal testing only, no store release
authorised), not a statement that the licence forbids release.

## Core pin

sing-box **v1.15.0-alpha.12**, commit `25b0d5ea3e466d246c708ac0f20d0448110e566c`, verified on
2026-10-17 as the newest upstream pre-release (published 2026-10-11). libbox is built from that
exact tag with upstream's own toolchain (Go 1.26.8, `sagernet/gomobile` v0.1.13, NDK r28, tags
`with_quic,with_utls,with_clash_api,badlinkname,tfogo_checklinkname0`). The build refuses a
different commit, a dirty tree, or a mismatched Go archive hash; Gradle refuses an AAR whose
SHA-256 differs from `supply-chain/sing-box/libbox.aar.sha256`
(`f75da79b…f58f8`). A second build reproduced the same hash (shared Go build cache). No floating
"latest" reference exists anywhere in the build.

## Routing (same contract as desktop `raydocs/tono@59082acf`)

`scripts/routing/sync-desktop-routing.py` generates `DesktopRoutingContract.kt` from the desktop
`direct_domains.rs` and `three-tier-template.json` (21 cloud-video exceptions, 166 Home entries,
`160.79.104.0/21`, 39 protected entries, domestic/overseas exact lists); `--check` fails on drift.

First match wins:

1. DNS hijack (port 53 / sniffed DNS) → Tono's DNS.
2. Cloud-video exceptions (TCP) → `Tono-Exit` (cloud). UDP/ICMP for them → reject.
3. AI / named Home suffixes, the Anthropic CIDR, and the Claude/ChatGPT/Grok Android packages (TCP)
   → Home (`Tono-Home-Residential` socks via the cloud, or the named Home node). UDP/ICMP → reject,
   so QUIC apps fall back to TCP instead of leaking.
4. Protected remainder → cloud. Three-tier only: overseas exact list → cloud.
5. Stale fake-IP destinations → reject (never direct).
6. Private/LAN destinations → direct.
7. Final: **three-tier (default)** → direct (domestic apps, browsing, unmatched); **stable** → cloud
   (UDP rejected).

If the account has no Home binding, AI goes to the cloud, never direct. If the server reports the
assigned Home is down (`503 CATALOG_UNAVAILABLE`) the app shows *Home unavailable* and does not
connect cloud-only. Matched traffic whose outbound fails is dropped, never retried direct — proven
by `scripts/routing/engine-route-harness.py` against the real sing-box binary with Home and then
the cloud killed.

**Disclosed boundary:** AI that is not in the contract (unknown domains, apps using ECH, their own
DoH or cached IPs) follows the final rule — direct in three-tier mode. Settings shows this text.

## Android platform decisions

- **All apps, all ports, both families.** TUN `198.18.0.1/30` + `fdfe:dcba:9876::1/126`, MTU 9000;
  every TCP/UDP port enters the tunnel — not the desktop's TCP 80/443 subset. IPv6 is captured even
  on IPv4-only networks so no v6 path bypasses the rules.
- **LAN.** RFC1918, CGNAT, link-local, multicast, `fe80::/10`, `ff00::/8` are excluded from the TUN
  routes (sing-tun subtracts `route_exclude_address`), so printers/casting/router pages keep working.
- **DNS.** Matched names (Home, video, protected; overseas list in three-tier; all names in stable)
  get fake IPs (`198.18.128.0/17`, `fc00::/18`) and never reach a local resolver. Direct names use
  the underlying network's resolver through `DnsResolver.rawQuery` on that network. Local suffixes
  (`.local`, `.lan`, `home.arpa`, reverse zones) stay local. Without global IPv6, direct AAAA gets an
  empty answer; the config reloads when IPv6 availability changes.
- **UDP/QUIC.** Direct UDP works (games, calls, domestic QUIC). Matched UDP is refused (fail closed).
- **Per-app split.** Users can exclude apps (bypass Tono entirely, including any AI inside them);
  Tono itself is never excluded so its exit checks traverse the rules.
- **Lifecycle.** Foreground `specialUse` service in `:vpn`; `START_STICKY`; always-on start via
  `android.net.VpnService` intent; `onRevoke` → *Allow VPN* state; network changes re-bind the
  underlying network; metered state follows the underlying network. Settings reports Android
  always-on / lockdown status and links to the system VPN page. Tono never calls `allowBypass()`.
- **Secrets.** Access/refresh tokens and the catalog body are stored with the existing
  Keystore-backed vault in no-backup storage; backup is disabled. The UI process never sees them.

## Licence

libbox is GPL-3.0-or-later with an upstream name-use term. Linking it means any distributed APK
must ship under GPL-compatible terms with corresponding source. The APK bundles the GPL text, the
upstream notice, provenance and a source record (`assets/licenses`, *Settings → About → Licences
and source*). GPL does not by itself forbid releasing; what remains before any public or store
distribution is a deliberate product-licence decision for the app as a whole, a review of the
name-use term, and (for iOS) App Store terms compatibility — tracked as release work, not done here.
ADR 0001 control 6 is satisfied for this round by the user's explicit decision to use sing-box for
internal test builds.

## Verification

- `./gradlew :android:routing:test` — catalog admission and routing policy (16 tests).
- `./gradlew :android:mobile:testDebugUnitTest` — HTTP framing, token refresh, error mapping,
  cross-process snapshot (7 tests).
- `scripts/routing/check-singbox-configs.sh android/routing/build/singbox-configs` — real
  `sing-box check` (pinned linux CLI, same commit) on generated configs.
- `scripts/routing/engine-route-harness.py` — real engine, stub cloud/Home, fail-closed checks.
- `HomeInteractionTest` (Robolectric, JVM): primary action per phase incl. cancel, button
  semantics/state description, short home vs. full Details text, verified-exit line.
- Motion preview (JVM frames on a manual Compose clock, not a device): `MotionPreview` →
  `build/motion/`, assembled with ffmpeg.
- On a real Android system (CI emulator, Android 14 x86_64). Output names say which kind each is:
  - `real-*`: the shipped app and the OS.
    - The sign-in screen and local e-mail validation (nothing is sent to the API).
    - The system VPN consent dialog, accepted through UiAutomator.
    - A connect request without an account, which must stay signed out with no VPN network.
    - The device-ABI libbox reporting the pinned version and accepting every generated config.
    - Frames compared with *Remove animations* off, on and off again.
    - The app under Android's light and dark themes.
    - The Quick Settings tile and the widget inside Android's own Quick Settings and widget host,
      showing this install's real (signed-out) status; a real tap on each opens sign-in.
  - `fixture-*`: the real UI fed fixture snapshots (no tunnel), marked "FIXTURE · no tunnel" on
    screen. Covers states, sheets, Settings and a screenrecord, plus these checks:
    - `A11yContract` together with Google's Accessibility Test Framework.
    - Real taps and a swipe injected through the system.
    - The screen-reader order, read from the accessibility tree.
    - Android's 200 % font size with no truncated text.
    - A measured glass blur: the stripe pattern behind glass, divided by the same glass without
      blur so the tint does not count, next to Android's own blur at the same radius.
    - Simplified Chinese on Home, Details and Settings (also at 200 % text on the JVM).
    - The motion frame by frame: the test clock advances 16 ms per frame and the device renders
      each one (`frames/`). This shows timing and easing, not real-time smoothness.
    - Widget and notification states, labelled "Fixture" on screen.
  - `local-*`: the shipped app on a real tunnel to local stand-in servers, not Tono's
    (`LocalTunnelDeviceTest`).
    - The flow: sign-in, Android's consent dialog, Connected after both exit checks, Details,
      Disconnect (the VPN network goes away) and sign-out.
    - Requests made from inside the tunnel to a video site, an AI site and an ordinary site. CI
      checks them against the stand-in exits' own logs: cloud, Home through the cloud, and direct.
  - Keyboard: Tab order, a visible focus ring and Enter, all through Android's input system; TalkBack's
    ACTION_CLICK on every Home control's platform node.
  - A small phone (360 × 640 dp): no truncated text, the accessibility contract holds, and every
    Home control can be reached.
  - `perf.txt`: cold start, APK size, frame stats and memory on the emulator. These are
    measurements, not a gate.
- Screenshots (no emulator needed):
  `./gradlew :android:mobile:testDebugUnitTest -Ptono.screenshots --tests '*ScreenshotRender*'`
  → `android/mobile/build/screenshots/`.

## Not yet verified

- No sign-in or connection against Tono's own service. That needs an allowlisted Tono account (the
  code arrives on the user's phone) and a catalog with an assigned Home.
  - What the local stand-ins have covered: the TUN, the three routing classes and the Home second
    hop, but only against stand-in servers on the CI host.
  - Still untested: QUIC fallback, always-on, app exclusion, network changes, and Tono's real exits
    and control plane.
  - The tile, widget and notifications have only been seen signed out (real) or with fixture states.
- Landscape on a device (see "Other screen shapes" above).
- Real hardware. The CI emulator renders in software (SwiftShader/ANGLE, about 5 fps under the animated
  scene), so motion smoothness, GPU blur cost, touch feel and battery are unmeasured. The blur
  itself does render there (stripes behind glass drop to 0.1 %), but its look on a phone panel has
  not been seen.
- TalkBack is not on the emulator image. Labels, roles and reading order are checked from the
  accessibility tree; speech and gestures are not.
