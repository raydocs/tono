# Tono

Cloud-managed VPN. Sign in, get a per-device exit catalog and a signed traffic
policy, connect through VLESS Reality. The control plane is not on the data
plane. Both clients fail closed at the OS packet layer (PF on macOS, WFP on
Windows).

This is Tono's own product, not a Clash Verge or LiquidClash reskin. Leftover
upgrade names exist only to stop old processes; they are not the product
identity.

![Tono dashboard](docs/screenshots/dashboard.jpg)

macOS (SwiftUI + privileged helper) and Windows (Tauri + LocalSystem service)
share one account, one catalog, and one device list. Ubuntu desktop and a
`tono` CLI are planned on the same privileged service; they are not shipped.

| Directory | Purpose |
|-----------|---------|
| [`apps/macos/`](./apps/macos/) | macOS client (SwiftUI + privileged helper) |
| [`apps/windows/`](./apps/windows/) | Windows client (Tauri + Service + WFP); Linux desktop packaging |
| [`services/control-plane/`](./services/control-plane/) | Cloudflare Worker, static assets, and D1 migrations |
| [`services/ops-console/`](./services/ops-console/) | Operator console |
| [`services/exit-agent/`](./services/exit-agent/) | VPS Xray roster + metering |
| [`services/home-agent/`](./services/home-agent/) | Home exit-node usage reporter |
| [`ops-panel/`](./ops-panel/) | SSH quality collector |
| [`tooling/scripts/`](./tooling/scripts/) | Build, release, test, and operations tooling |
| [`docs/`](./docs/) | [Document map](docs/README.md) — architecture, ship plan, ops, archive |

See [architecture](docs/architecture.md) for the system map. Agents: start at
[AGENTS.md](./AGENTS.md).

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
