## 2026-10-17 · iOS client: tunnel ownership, system protection defaults and App Store licence boundary
- Status: provisional
- Chosen:
  - **Core.** Official sing-box libbox v1.15.0-alpha.12 (`25b0d5ea`), the same release as the Android
    client, built from source by `apps/ios/supply-chain/build-libbox-apple.sh` inside an
    `NEPacketTunnelProvider`. Rejected: the old `feat/ios-native-companion` patched alpha.3 runtime
    (it refuses Home/DIRECT and needs a custom fork) and an empty Network Extension shell.
  - **Routing.** The Android graph unchanged: 21 video exceptions → 166 Home entries + Anthropic
    CIDR → explicit cloud list → everything else DIRECT. A matched route that fails is refused, never
    retried DIRECT. iOS has no `package_name`, so AI apps are recognised by domain and CIDR only, and
    there are no per-app exclusions; the app says so in Settings.
  - **Secrets.** Account tokens stay in the app's own Keychain item (after-first-unlock, this
    device only). The tunnel extension gets the admitted catalog body and the user's choices through
    the App Group, re-admits the body itself, and never calls the control plane. Rejected: a shared
    keychain group, which would hand refresh tokens to the extension.
  - **System protection defaults.** `includeAllNetworks` on (user can turn it off),
    `excludeLocalNetworks` on, APNs and cellular services excluded on iOS 16.4+. Connect On Demand is
    turned on when the user connects and off when the user disconnects, so iOS restarts Tono after a
    crash, jetsam, update or reboot. A start the user asked for that never reaches connected turns
    On Demand off (no background retry loop); a running tunnel the system stops keeps it on.
  - **Probes.** The exit checks run in the app (its traffic is tunnelled); the extension's own
    sockets bypass the tunnel, so it only measures node latency outside the tunnel.
  - **Identifiers.** `com.raydocs.tono.ios`, `com.raydocs.tono.ios.tunnel`,
    `group.com.raydocs.tono.ios`, overridable through the gitignored `Local.xcconfig`.
  - **Licence boundary.** Builds for internal testing only. sing-box is GPL-3.0-or-later with an
    added name-use restriction; distributing the combined app needs the corresponding source and
    GPLv3 installation information, and whether App Store terms are compatible with GPLv3 §10 is
    disputed. Publishing to the App Store (or a public TestFlight link) waits for an owner or legal
    decision. This is a recorded boundary, not legal advice and not a claim that GPL forbids it.
- Why stricter: `includeAllNetworks` holds traffic while the tunnel restarts instead of letting it
  out directly; tokens never reach the extension; the extension trusts only a catalog it admitted
  itself; no store distribution until the licence question has an owner answer.
- Applied in: branch `feat/ios-singbox-horizon` (`apps/ios/`).
