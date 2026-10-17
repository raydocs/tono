# Tono for iOS

A test-stage iPhone client in the same product family as the desktop apps and the Android client
(`rw8/Tono-droid`, branch `feat/mobile-singbox-premium`). It signs in with email, fetches the
account's exit catalog, and runs the official sing-box core inside a Network Extension packet tunnel
with the desktop three-tier routing. Not a SHIP_PLAN gate and not an App Store release.

```diagram
┌──────────────────────────── Tono.app ────────────────────────────┐
│ SwiftUI (Horizon design)   AppModel ── ConnectionState.derive     │
│ AccountSession (TonoKit) ── control plane: system DNS, then relays│
│ Keychain: tokens only      exit checks through the live tunnel    │
└───────┬───────────────────────────────────────────────▲──────────┘
        │ App Group: tunnel-inputs.json                 │ NEVPNStatus,
        │ (admitted catalog body + mode + line)         │ provider messages,
        ▼                                               │ libbox command socket
┌──────────────── PacketTunnel.appex ──────────────────────────────┐
│ re-admit catalog → SingBoxConfig (same graph as Android)          │
│ libbox (sing-box 1.15.0-alpha.12) ── TunnelPlatform (utun, routes)│
└───────────────────────────────────────────────────────────────────┘
```

## Layout

| Path | What |
| --- | --- |
| `TonoKit/` | Swift package with no Apple-only imports: catalog admission (restricted YAML, Reality-only, public IPv4), the sing-box graph, the route explainer, the control-plane client (system DNS → relays, HTTP/1.1 for relays), account/session/catalog cache, connection phases. Builds and tests on Linux and macOS. |
| `App/` | SwiftUI app: sign-in, Home (sea scene, state, one status line, primary capsule, exit capsule), Details (lanes, full reason, mode), lines sheet, Settings (mode, boundaries, route checker, iOS protection, account, about). `en` and `zh-Hans` copy uses the Android string keys. |
| `PacketTunnel/` | `NEPacketTunnelProvider` + libbox platform interface (TUN → `NEPacketTunnelNetworkSettings`, utun descriptor, default-interface monitor, IPv6 reload, sleep/wake, screen state). |
| `Shared/` | App Group files and node latency, compiled into both targets. |
| `supply-chain/` | `sing-box.pin` and `build-libbox-apple.sh` (pinned Go, upstream iOS Go patch, gomobile; verified by SHA-256 and commit). |
| `tools/` | Routing-list sync from the desktop sources, the sing-box CLI route harness, simulator screenshots. |
| `project.yml` | XcodeGen spec; the `.xcodeproj` is generated, not committed. |

## Routing (same order as desktop and Android)

1. DNS hijack. 2. 21 cloud video exceptions → cloud (TCP; UDP/QUIC refused), ahead of the broad
Home parents. 3. 166 named Home entries and Anthropic's `160.79.104.0/21` → cloud → assigned Home
(TCP; UDP refused). 4. Remaining protected Tono hosts and the explicit overseas list → cloud.
5. Stale fake IPs refused. 6. LAN/private → DIRECT. 7. Everything else: DIRECT (three-tier) or cloud
with UDP refused (stable). A matched route that fails is refused, never retried DIRECT.

iOS has no per-app identity: no `package_name` rules and no per-app exclusions. AI is recognised by
domain and CIDR only, so an app using ECH, its own DoH or cached addresses can hide AI traffic, which
then goes DIRECT. Settings states this boundary.

The tunnel covers every app, TCP and UDP on all ports, IPv4 and IPv6. LAN, link-local, multicast and
CGNAT stay outside; with `includeAllNetworks` (default on) APNs and cellular services are excluded so
calls and push keep working. Without global IPv6 on the phone's network, DIRECT names answer IPv4
only, and the graph is rebuilt when that changes. MTU 4064 (the utun limit sing-box uses on NE).

## Build (Mac with Xcode 16+; nothing here runs on Linux)

```sh
apps/ios/supply-chain/build-libbox-apple.sh          # → apps/ios/Frameworks/Libbox.xcframework (+ provenance)
cp apps/ios/Configuration/Local.example.xcconfig apps/ios/Configuration/Local.xcconfig   # set DEVELOPMENT_TEAM
xcodegen generate --spec apps/ios/project.yml        # XcodeGen 2.44.1
open apps/ios/Tono.xcodeproj
```

A device build needs an Apple Developer team with the **Network Extension (Packet Tunnel)** and
**App Groups** capabilities on both bundle IDs, and the App Group registered. The simulator cannot
run a packet tunnel; it can show the DEBUG design preview:

```sh
xcrun simctl launch booted com.raydocs.tono.ios -TonoPreview CONNECTED -TonoPreviewSheet lines
```

`-TonoPreview` shows fictional fixture lines with no account and no tunnel. It is compiled only in
Debug; the CI device build fails if a Release binary contains it.

## Verification

| Check | Where | Status |
| --- | --- | --- |
| `swift test` in `TonoKit` (catalog, routing, account, phases) | Linux, macOS CI | runs |
| `tools/sync-desktop-routing.py --check` | Linux | runs |
| `tools/check-singbox.sh`: pinned sing-box CLI `check` + real-kernel route harness for 4 graphs, incl. Home-down / cloud-down fail-closed | Linux | runs |
| libbox build, unsigned device + simulator `xcodebuild`, preview screenshots | `.github/workflows/ios-ci.yml` on GitHub-hosted `macos-26` | see the PR |
| Signed device install, tunnel start, real catalog, DNS/IPv6/UDP/LAN behaviour, On Demand recovery, memory under the 50 MB extension limit | iPhone + Apple Developer team | **not run** |
| TestFlight / IPA | — | **none exists** |

## TestFlight: what the owner must provide (nothing here is done)

Never paste a private key, `.p12`, `.p8` or password into a chat or the repo; put them in the
Mac keychain or GitHub Actions secrets.

Ordinary Apple Developer Program capabilities (self-service in the developer portal, no request):
1. A paid Apple Developer Program membership and its **Team ID** (`DEVELOPMENT_TEAM` in
   `Configuration/Local.xcconfig`, or a CI variable). **Organization** enrolment, not individual:
   App Review guideline 5.4 requires VPN apps to come from an organization, and external TestFlight
   goes through Beta App Review.
2. Two explicit App IDs: `com.raydocs.tono.ios` and `com.raydocs.tono.ios.tunnel` (or the owner's
   prefix, set via `TONO_BUNDLE_ID`), both with **Network Extensions** and **App Groups** enabled.
3. The App Group `group.com.raydocs.tono.ios` (`TONO_APP_GROUP`) registered and assigned to both IDs.
   `packet-tunnel-provider` is a standard NE capability for paid teams; `includeAllNetworks` and On
   Demand need no extra entitlement.
4. Signing: an **Apple Distribution** certificate (private key stays with the owner) and two **App
   Store** provisioning profiles (app + extension), or Xcode automatic signing; for CI, an App
   Store Connect API key (issuer ID, key ID, `.p8`) stored as repository secrets.
5. For on-device debugging before TestFlight: a registered iPhone UDID and development profiles.
6. An App Store Connect app record (name, bundle ID, SKU), the export-compliance answers
   (`ITSAppUsesNonExemptEncryption` is `true`: TLS/Reality tunnel encryption), a privacy-policy URL
   and beta-review contact for external testers.

Not a capability request, but blocks distribution:
- The GPL-3.0 / sing-box name-clause answer ([decision 129](../../docs/decisions/129-2026-10-17-ios-client-tunnel-defaults.md)).
- VPN apps are not available on the China mainland App Store; whether TestFlight testers there can
  install is unverified.
- No extra Apple approval is needed for this packet tunnel. Other Network Extension types
  (content filter, DNS proxy, app proxy / per-app VPN) have their own rules; Tono uses only
  `packet-tunnel-provider`.

## Licence

sing-box is GPL-3.0-or-later with an added condition: "no derivative work may use the name or imply
association with this application without prior consent". Tono names it only as the included core
in About. Distributing an app that links libbox carries GPLv3 obligations for the combined work
(corresponding source, and installation information for a "User Product" such as a phone), and
whether App Store terms are compatible with GPLv3 §10 is disputed. The upstream author ships their
own client on the App Store as the copyright holder, which does not settle it for third parties.
Builds here are for internal testing; App Store or public TestFlight distribution waits for an owner
or legal decision ([decision 129](../../docs/decisions/129-2026-10-17-ios-client-tunnel-defaults.md)).
This is a recorded boundary, not legal advice.
