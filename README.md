# Tono

Cloud-managed VPN clients and services.

| Directory | Purpose |
|-----------|---------|
| [`apps/macos/`](./apps/macos/) | macOS client (SwiftUI + privileged helper) |
| [`apps/windows/`](./apps/windows/) | Windows client (Tauri + Service + WFP) |
| [`services/control-plane/`](./services/control-plane/) | Cloudflare Worker, static assets, and D1 migrations |
| [`services/home-agent/`](./services/home-agent/) | Home exit-node usage reporter |
| [`tooling/scripts/`](./tooling/scripts/) | Build, release, test, and operations tooling |
| [`docs/`](./docs/) | Screenshots and archived project handoffs |

The repository is organized by deployable application, service, and shared tooling.

## Windows quick start

```powershell
cd apps/windows
# see apps/windows/README.md and tooling/scripts/build-windows-release.ps1
```

## macOS quick start

Open `apps/macos/LiquidClash.xcodeproj` in Xcode. App sources live in
`apps/macos/Tono/`.

## Releases

Windows stable installers use `v<version>` tags; legacy Windows prereleases use
`tono-windows-*` tags. Future macOS releases use
`tono-macos-<version>-build<build>` tags.

The maintained release lines are `release/macos` and `release/windows`;
`main` is their reviewed integration point and the only production
control-plane deployment source. See [release lines and immutable
history](docs/RELEASE_LINES.md).
