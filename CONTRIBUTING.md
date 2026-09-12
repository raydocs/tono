# Contributing to Tono

Thanks for your interest in contributing!

## Project Structure

```text
tono/
├── apps/
│   ├── macos/                 SwiftUI client and privileged helper
│   └── windows/               Tauri GUI, Service, WFP; Linux desktop packaging
├── services/
│   ├── control-plane/         Cloudflare Worker, static assets, and D1 schema
│   ├── ops-console/           Operator console
│   ├── exit-agent/            VPS Xray roster + metering
│   └── home-agent/            Home exit-node usage reporter
├── ops-panel/                 SSH quality collector
├── tooling/scripts/           Shared build, release, test, and operations tools
├── docs/                      Product, architecture, ship, ops; archive for handoffs
└── .agents/                   Repository-specific automation guidance
```

See [`docs/README.md`](docs/README.md) for the document map and
[`docs/architecture.md`](docs/architecture.md) for the system map.
Agents: [`AGENTS.md`](AGENTS.md).
Ubuntu desktop and a `tono` CLI share the same privileged service; that
Linux product line is not shipped yet.

## Build from Source

```bash
git clone https://github.com/raydocs/tono.git tono
cd tono
open apps/macos/Tono.xcodeproj
```

Build and run the macOS client with `⌘R` in Xcode. Requires macOS 26.0+ and
Xcode 26.0+. See `apps/windows/README.md` for Windows prerequisites and build
instructions.

## Branch and release ownership

macOS work is released from `release/macos`, Windows work from
`release/windows`, and both are merged normally into `main`. Only `main` may
deploy the shared production control plane. See
[`docs/RELEASE_LINES.md`](docs/RELEASE_LINES.md) for tag formats, immutable
legacy records, update-channel ownership, and merge gates.
