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
  aside; sign-in centres its card. On the CI emulator, l3 turns the display while Tono's window is in
  front (the first two attempts rotated before launch and stayed portrait); `landscape-report.txt`
  says whether the system rotation turned it or the activity had to ask for landscape.
- **Copy.** A stopped hop is "paused" (暂停) everywhere: the status line, Details and the routing
  scope.
- **Fixture captures.** The fixture mark sits in the status-bar band, and fixture hosts draw edge to
  edge as the app does.

Round 7 (after the round-6 blind reviews, `docs/agent-reports/2026-10-18-android-r6-*` in raydocs/tono):
- **The engine's word, or "Status unknown".** The UI keeps the engine's last snapshot but tracks
  whether it is current (`EngineLink`: waiting, live, lost). When the `:vpn` process dies (and the
  tunnel with it), Home says *Status unknown* and drops the sun, the progress fill, the timer, the
  speed and the Details and Lines sheets until the restarted engine speaks. Disconnect still works
  then: without the binder it goes to the engine's service as an intent. Coming back from the
  background, the app reads the current snapshot before its first frame instead of showing the one
  from before. The engine no longer sends its start-up placeholder (signed out) to a client before
  it has read the account, which could flash the sign-in screen after a restart. The QS tile already
  required a VPN network for Connected; the open app now also asks the tile and widget to look again
  when the engine dies.
- **Wording.** The always-on advice names Android's "block connections without VPN", the only
  setting that keeps apps from going direct while Tono restarts. A failed exit check says it was the
  last check ("Home check failed · AI paused") instead of saying Home is down. After a switch between
  Wi-Fi and mobile, the engine checks both exits again and Home says so instead of repeating the old
  verdict.
- **Landscape in the real app.** Home's controls and the other screens keep clear of a camera
  cutout at the side; Tono's consent explanation survives turning the phone (it is saved state, also
  across process recreation).
- **Motion.** State words cross-fade with a short overlap instead of back to back, and are no longer
  clipped while the label width changes (frame-by-frame review found 64–100 ms with no words, and a
  cut-off "Not connectec").
- **Sheets.** The sheets draw their grip themselves: Material's handle is a keyboard focus stop whose
  "Drag handle" tooltip covered the sheet title.
- **CI.** Three emulator shards (`system`, `tunnel`, `ui`). Each measures the sign-in screen's
  median frame time before the tests. Emulators at 300–750 ms ran every test at normal speed; from
  800 ms up, tests hung in waits for an idle main thread under the animated sea (runs 39153105611,
  39159687608, 39163947970; at 850 ms launching the app alone took 9 minutes). Tests that are not
  about motion therefore run with Android's *Remove animations*; a5, b2, u8 and t3 are the motion
  evidence and keep motion on, starting still where they launch the real app. The gate stops an
  attempt only above 1000 ms, the slowest seen so far: at 775 ms it stopped all four ui and tunnel
  emulators of run 39167725741 twice, and at 650 ms it had stopped healthy ones (run 39151329824).
  A hung test is stopped after 600 s with a screenshot, window dump and focus state, and a shard
  that passes only on the fresh-emulator retry is marked flaky.
- **Real-app device tests no longer wait for the main thread to go idle.** `ActivityScenario.onActivity`
  waits for idle, which never comes under the animated scene on a slow emulator (t2 hung there in
  run 39153105611). The tests reach the resumed activity directly, start from signed out whatever an
  earlier test left, and keep the sea still where they only need layout. The Compose test rule is
  applied only around the 200 % text test, which drives the app through it: under the rule the app's
  composition advances only when the rule synchronises, so the app stayed on its first frame for the
  UiAutomator-driven tests (run 39159687608).
- **After the engine's process dies**, the app (if running) replaces the engine's ongoing
  notification with *Status unknown · Open Tono to check*: Android had left it up, still saying
  Connected, for the whole 90 s fault-injection window (run 39170392763). With the app in front and
  the engine still gone after 3 s, the app starts the engine as Android's own restart would (Android
  had not restarted it within 90 s in that run), so a tunnel the user wanted comes back, and binds
  to it afresh: when Android drops the dead service instead of restarting it, the old binding never
  connects again (run 39173982324: tunnel back up, screen still on *Status unknown*). Coming back to
  the app after the engine died away from it does the same. A restart request reaching an engine
  that already runs the tunnel changes nothing, and a restarted engine with no tunnel clears the
  app's replacement.
- **Sheets stop below the status bar**, so the clock and the local-test-server or fixture mark stay
  in sight with a sheet open, also in landscape where Details reaches the top.

Round 8 (after the round-7 blind reviews, `docs/agent-reports/2026-10-19-android-r7-*` in raydocs/tono):
- **The notification checks itself.** Every time the engine writes its shared status with a tunnel
  up or starting, it also arms an alarm for 40 s later (the 30 s heartbeat plus 10 s; inexact and
  non-waking, so it runs once the phone is next awake). The alarm reaches a receiver in the app's
  main process, not the engine's, so it still runs when the engine has died with no screen open.
  It compares what the engine's notification claims (the engine stamps the phase on it) with what
  the shared status can still vouch for: a fresh record from this boot and, for Connected, a VPN
  network Android still has. If the claim is unsupported, it replaces the notification with *Tono
  stopped · No VPN network · Open Tono to reconnect* (Android has no VPN network; whether apps then
  go direct or are blocked depends on Android's "block connections without VPN", which the app
  cannot read) or *Status unknown*, and logs that it did. With the phone awake, that is 10–70 s after the engine's last write.
- **Fault injection with no app open (t5).** Connected through the real app, then MainActivity is
  closed (no activity, the ViewModel cleared, no binding to the engine), the home screen is in
  front, and the `:vpn` process is killed. For up to 150 s the test samples Android's VPN network,
  the notification's title and claimed phase, and whether Android restarted the engine. No sample
  may show a tunnel claim without a VPN network later than 90 s (the shared status's staleness
  limit); if Android kept the notification and did not restart the engine, the watchdog must have
  replaced it (its log line) and it must say *Tono stopped*. Not covered: the app's main process
  stays alive (it hosts the test), so the alarm reaches a running process instead of starting one,
  and the phone stays awake (no Doze).
- **Catalog unavailable** no longer reads as "Home exit unavailable": the control plane uses that
  code for its server catalog, identity issuance and Home alike, so Tono says it cannot hand out
  your lines right now.
- **Wording.** The timer's screen-reader text says "Tunnel up for …" (it also shows while partly
  working, where "Connected for" contradicted the state). The lost-engine line says *Tono stopped
  responding* instead of "Engine stopped".
- **Connecting** paints a lower sun than before (0.5 of the day sky instead of 0.7), so it no longer
  reads like Connected; the dawn while preparing is lower too.
- **Checks.** `A11yContract` also flags any clickable node without a label whatever its role, and
  text lines wider than their own box. The cutout check in t2 asserts that Android reports a
  non-empty cutout, records it, and leaves out only the sheet's "Close sheet" scrim instead of every
  window-sized node; t2 also turns to 270°. t4 (200 % text) also covers a real Connected, partly
  working and failed connect. CI now uploads the JVM test XML (`routing/`, `mobile/build/test-results/`)
  next to the HTML, and restores animations before `perf.txt` measures frames.

Round 9 (after the round-8 blind reviews, `docs/agent-reports/2026-10-19-android-r8-*` in raydocs/tono):
- **The notification turns honest when the engine dies, not up to a minute later.** Round 8's alarm
  left the notification saying Connected for about 57 s with no VPN network (t5, run 39184008733).
  Now, while a tunnel is up or starting, the engine stays bound to a small service in its own process
  (`:watch`) and hands it a binder that lives in the engine's process. When the engine's process
  dies, the binder dies with it and the watch hears it at once; it replaces the notification (with
  *Status unknown* if Android still lists a VPN network at that instant, then *Tono stopped · No VPN
  network* once it is gone) and asks the tile and widget to look again. The binding keeps the watch's
  process at the engine's priority, so it is there to hear it, and nothing depends on the app's main
  process or an open screen. The open app does the same when it loses its binding.
- **Backstop.** If the watch's process dies together with the engine, the alarm the engine keeps
  re-arming still fires and starts a fresh watch process. The heartbeat is now 10 s (was 30 s) and
  the alarm 20 s ahead (was 40 s), so with the phone awake that window is about 10–35 s; a shared
  record now counts as stale after 30 s (was 90 s), and the widget looks again 40 s after the last
  live status (was 100 s).
- **Fault injection.** t5 (no app open) now allows a tunnel claim without a VPN network for at most
  3 s after the VPN network is seen gone, sampled every 100 ms, and requires the watch to log that it
  heard the death from its own pid and, unless Android had already removed the notification with the
  process, to have replaced it; the status the tile and widget read may never say Connected without
  a VPN network. t6 repeats the fault in forced deep Doze (`dumpsys deviceidle
  force-idle deep`, checked with `get deep` = `IDLE`) with the same 3 s limit, and with the watch
  dead too (frozen, the engine killed, then the watch killed): the backstop alarm must be pending
  before the fault (`dumpsys alarm`), and if Android keeps the notification without restarting the
  engine, the alarm must start a fresh watch process and replace it (window measured, asserted below
  60 s). If Android instead restarts the engine or drops the notification, that is recorded and the
  alarm path is not exercised in that run.
- **A restarted engine's re-posted notification is replaced.** When Android itself restarts a
  crashed engine it first drops the notification, then re-posts the dead engine's last one when the
  new process starts, before any of Tono's code runs (run 39193223160: "Connected" with no VPN
  network for about 0.2 s; run 39197246583, in Doze: 0.4–0.7 s, until the new engine's first step
  replaced it). Now the watch, having heard the death, also replaces a re-posted Connected or Partly
  working claim (checking every 100 ms for 10 s, or until a new engine shows it is alive: its first
  shared-status write or its registration with the watch, both long before it can be connected), and
  the new engine process still replaces any leftover claim in its first step. t5/t6 hold a re-posted
  claim without a VPN network to under 1 s (measured up to the first sample without it), and once a
  restarted engine is connected again its notification must say Connected for the next 12 s. That
  last check came from run 39202302351: green, but its t6 log showed the first version of the
  re-post check (kept per service instance; Android destroys the watch's instance when its only
  client, the engine, dies) replacing the reconnected engine's own Connected 6 s after the death. The watch now
  logs every death it hears, also when there is nothing left to replace (run 39197246583 failed t6
  on that: Android had removed the notification itself, so the watch had nothing to replace and
  logged nothing).
- **Motion tests and an idle main thread.** b2 and t3 finished their steps, then hung for 600 s in
  closing the activity (runs 39193223160, 39197246583): closing waits for an idle main thread, and
  the round's heavier reflection left the emulator's main thread none. The reflection is back to
  about the earlier stroke count (28 rows of two glints instead of 46 rows of two or three, no round
  caps, the glow without a blend mode), and the motion tests turn motion off just before closing.
  a5 now waits 4 s (was 1.5 s) after each change of the animation setting before comparing frames:
  at 750–1200 ms a frame, its first attempt in run 39202302351 caught the last moving frame in the
  still pair (0.23 % of the scene changed); the retry measured 0.
- **Failed no longer looks like connecting.** On a failed connect the sun sets below the horizon and
  only its ember afterglow stays; connecting keeps a rising half sun. The sea's reflection is a soft
  column of light (under the sun only, kept narrow: the first, wider version coincided with slower
  emulator frame times in run 39190910753) with uneven glints instead of a regular ladder of lines.
- **Glass.** The rim is lit from above and fades along the sides instead of one uniform outline on
  every pill, and a faint warm caustic runs along the bottom edge.
- **Sign-in.** The code field takes focus when it appears, so the keyboard is up without another tap.
  At large text sizes the sign-in screen leaves the moon out: the introduction reached its place.
- **Checks.** The cutout check also counts unlabelled controls (it still leaves out the local-test-
  server mark and the full-window "Close sheet" scrim), and t2 checks Details at 270° too. A missing
  code step in the device tests now leaves a screenshot and window dump.

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
`direct_domains.rs` and `three-tier-template.json` (21 cloud-video exceptions, 194 Home entries,
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
  cross-process snapshot, the engine link (death, restart, return from the background), the
  notification watchdog and engine-death replacement, Home and accessibility contracts: 53 tests
  discovered, 17 of them (screenshot and motion renders, opt-in with `-Ptono.screenshots`) skipped
  by default, so 36 run.
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
    - The system VPN consent dialog, accepted through UiAutomator. a2 opens the dialog directly from
      the test; the app's own way to it (Connect → Tono's explanation → Android's dialog) is t1/t3.
    - A connect request without an account, which must stay signed out with no VPN network. a4
      sends it to the engine's service with no screen; it does not exercise the UI.
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
    - The flow: sign-in, with VPN consent withdrawn first so Tono's explanation and then Android's
      consent dialog both appear, Connected after both exit checks, Details, Disconnect (the VPN
      network goes away) and sign-out.
    - Fault injection: the engine's `:vpn` process is killed with the tunnel up and the real app in
      front. Until the restarted engine reconnects, nothing may say Connected without a VPN network:
      Home (after a 1.5 s grace to redraw), the status the tile and widget read, or the
      notification. Home must say *Status unknown*, and the sign-in screen must never appear. Then
      the app goes to the home screen and back, and must show Connected again without passing
      through *Status unknown*. This is the app in front; the 1.5 s grace was only exercised with
      animations removed, and the first frame on return is checked from the screen, not recorded.
    - The same fault with no app open (t5, see Round 9): the notification may claim a tunnel
      without a VPN network for at most 3 s after the VPN network is seen gone, replaced by the
      watch process. The app's main process is alive (it hosts the test) but takes no part.
    - t6: the same in forced deep Doze (3 s limit), and with the watch killed together with the
      engine (the alarm starts a fresh watch; window measured, asserted below 60 s).
    - The real app turned to landscape (t2): the code step with the on-screen keyboard up, typed
      digits kept, the code field above the keyboard; Home and Details at 90° and at 270° with no
      labelled node or unlabelled control under the camera cutout (Android must report a non-empty
      cutout; the local-test-server mark and the sheet's full-window "Close sheet" scrim are left
      out); Tono's consent explanation still open after turning back.
    - The real app's states on `MainActivity` (t3): idle, connecting, Connected, partly working
      (the stand-in Home exit down → *Home didn't answer*, VPN still up) and failed (catalog
      unavailable → no VPN, Retry). The sky's luminance is asserted per state, and the run is
      screen-recorded (`local-real-motion.mp4`).
    - The real app at the largest system text, 200 % (t4): sign-in, code step, Home (not connected,
      then a real Connected, partly working and failed connect), Details and Settings with no text
      cut off and every control ≥ 48 dp and labelled.
    - Requests made from inside the tunnel to a video site, an AI site and an ordinary site. CI
      checks them against the stand-in exits' own logs: cloud, Home through the cloud, and direct.
  - Keyboard: Tab order, a visible focus ring and Enter, all through Android's input system; TalkBack's
    ACTION_CLICK on every Home control's platform node.
  - A small phone (360 × 640 dp) and landscape: no truncated text, the accessibility contract holds,
    and every Home control can be reached.
  - `perf.txt`: cold start, APK size, frame stats and memory on the emulator. These are
    measurements, not a gate. The CI health gate (sign-in frame time ≤ 1000 ms) only admits an
    emulator fast enough to run the tests; it is not a performance result.
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
- Landscape on a phone; the emulator checks are above (a fixture host in l3, the real app in t2).
- The widget redraws when the engine publishes, when the open app sees the engine die, or on its
  own check, an inexact non-waking alarm set 40 s after the last live status. That is not a strict
  bound: Android may run it later, and not before the phone is next awake. A widget placed on a
  home screen while the engine dies has not been run on a device; t5/t6 check the status it reads.
- The engine-death replacement on devices: the watch's binder-death path is exercised awake and in
  forced deep Doze on the emulator, with the app's main process alive (it hosts the tests, though it
  plays no part). When the watch dies together with the engine, only the alarm remains: about
  10–35 s with the phone awake, later under Doze, app standby buckets or OEM background limits
  (only the awake case is exercised). Real phones, OEM process killers and the screen-off-then-on
  moment are not exercised.
- Real hardware. The CI emulator renders in software (SwiftShader/ANGLE, about 5 fps under the animated
  scene), so motion smoothness, GPU blur cost, touch feel and battery are unmeasured. The blur
  itself does render there (stripes behind glass drop to 0.1 %), but its look on a phone panel has
  not been seen.
- TalkBack is not on the emulator image. Labels, roles and reading order are checked from the
  accessibility tree; speech and gestures are not.
