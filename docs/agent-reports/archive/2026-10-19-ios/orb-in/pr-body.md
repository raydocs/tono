Draft. Not for merge: iOS is outside SHIP_PLAN 0.0.75 (§1 lists Android / iOS as not in this release), and the G4 freeze only merges SHIP_PLAN §2 item 10. Plan: ops plan §P2, "Android / iOS 客户端".

## What this adds (`apps/ios/`, new)

- **TonoKit** (Swift package, no Apple-only imports, runs on Linux): catalog admission (restricted YAML, Reality-only, public IPv4, hy2 stripped), the **same sing-box 1.15 graph as Android** (21 video exceptions → 166 Home entries + Anthropic CIDR → explicit cloud list → everything else DIRECT; a matched route that fails is refused, never retried DIRECT), route explainer, control-plane client (system DNS, then the 3 API relays), email sign-in, token rotation, catalog rollback refusal with a 7-day cache, connection phases and the primary action per phase.
- **PacketTunnel**: `NEPacketTunnelProvider` on official libbox **v1.15.0-alpha.12 (`25b0d5ea`)**, the Android pin, built from source by `supply-chain/build-libbox-apple.sh`. TUN routes v4/v6 (LAN/CGNAT/link-local/multicast excluded), DNS hijack with fake IP, IPv6-change reload, sleep/wake, screen state. The extension holds **no tokens** and re-admits the catalog itself.
- **App**: SwiftUI, same structure as Android direction B (`4bb6536`): Home = state title → one status line → primary capsule (Connect / Cancel / Disconnect + mm:ss, sunrise fill) → exit capsule → Details (lanes, full reason, mode). Sign-in, lines, settings. Liquid Glass on iOS 26 (opaque under Reduce Transparency / Increase Contrast), Dynamic Type, VoiceOver labels, Reduce Motion, haptics. en + zh-Hans on Android's string keys. **Sun-on-the-horizon brand** drawn by the desktop generator (decision 095).
- **Decision 129 (provisional)**: tokens in the app Keychain; `includeAllNetworks` on by default; On Demand follows connect/disconnect; App Store distribution waits for an owner/legal answer on GPL-3.0 + sing-box's name clause.
- **`.github/workflows/ios-ci.yml`**: `feat/ios-**` pushes and manual dispatch, GitHub-hosted Linux + `macos-26`. Not wired into ci-gate.

## Build (hosted, run [39078716807](https://github.com/raydocs/tono/actions/runs/39078716807) on `63066f0`, all green)

libbox from pinned source → XcodeGen → **unsigned Release device build** (Tono.app + PacketTunnel.appex; fails if the DEBUG preview is in Release) → **Debug simulator build** → installed and launched on an iPhone 17 Pro simulator (iOS 26) → 46 screenshots, 3 videos, `perf.txt` → **9 XCUITests** (6 interaction flows + Apple accessibility audit of 7 home states, 3 sheets, 5 screens at AX5).
Artifact [`ios-preview-screenshots`](https://github.com/raydocs/tono/actions/runs/39078716807/artifacts/12118980608), retained 14 days (until 2026-10-31). Every capture and test runs the DEBUG `-TonoPreview` fixture (yellow badge "fixtures, no account/tunnel"); it shows layout, copy, interaction and motion, **not** sign-in or connectivity. `perf.txt` CPU is the Mac simulator host, not an iPhone.

## TestFlight: owner-supplied (see `apps/ios/README.md`)

Organization developer account + Team ID; App IDs `com.raydocs.tono.ios` / `.tunnel` with Network Extensions + App Groups; App Group `group.com.raydocs.tono.ios`; Apple Distribution certificate + two App Store profiles (or automatic signing with an App Store Connect API key as repo secrets); App Store Connect record + export compliance. `packet-tunnel-provider` needs no extra Apple approval. Plus the GPL decision. No keys in chat.

## Not done / not claimed

No device test, signing, IPA or TestFlight upload. Real-iPhone tunnel behaviour (real catalog, DNS, IPv6, UDP, On Demand recovery, 50 MB extension memory) is unverified. UI self-audit round 3: 86/100 on simulator-fixture evidence (authenticity/performance 4/5 rests on Mac-host CPU only; with a device-only reading it is 3/5, under the 70% floor). VoiceOver by hand, haptics, ProMotion frame pacing and on-device memory are unverified.

## Merge order

None. Draft until a device run and an owner decision.

https://ampcode.com/threads/T-01a14a94-6bc1-73df-bb3b-eb8c35369b9b

