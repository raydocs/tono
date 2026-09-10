# Tono

Cloud-managed VPN clients and services.

| Directory | Purpose |
|-----------|---------|
| [`apps/macos/`](./apps/macos/) | macOS client (SwiftUI + privileged helper) |
| [`apps/windows/`](./apps/windows/) | Windows client (Tauri + Service + WFP); Linux desktop packaging |
| [`services/control-plane/`](./services/control-plane/) | Cloudflare Worker, static assets, and D1 migrations |
| [`services/exit-agent/`](./services/exit-agent/) | VPS Xray roster + metering |
| [`services/home-agent/`](./services/home-agent/) | Home exit-node usage reporter |
| [`ops-panel/`](./ops-panel/) | SSH quality collector |
| [`tooling/scripts/`](./tooling/scripts/) | Build, release, test, and operations tooling |
| [`docs/`](./docs/) | Architecture, screenshots, archived handoffs |

The repository is organized by deployable application, service, and shared tooling.
See [architecture](docs/architecture.md) for the system map. Ubuntu desktop and
a `tono` CLI are planned on the same privileged service; they are not shipped yet.

## Windows quick start

```powershell
cd apps/windows
# see apps/windows/README.md and tooling/scripts/build-windows-release.ps1
```

## macOS quick start

Open `apps/macos/Tono.xcodeproj` in Xcode. App sources live in
`apps/macos/Tono/`.

## Releases

Windows stable installers use `v<version>` tags; legacy Windows prereleases use
`tono-windows-*` tags. Future macOS releases use
`tono-macos-<version>-build<build>` tags.

The maintained release lines are `release/macos` and `release/windows`;
`main` is their reviewed integration point and the only production
control-plane deployment source. See [release lines and immutable
history](docs/RELEASE_LINES.md). The next customer publication is gated
by [the first-ship plan](docs/SHIP_PLAN.md); do not promote Sparkle or
`windows-updates` while those four gates are open.
