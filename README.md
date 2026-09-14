# Tono

Cloud-managed VPN for macOS and Windows. Sign in, receive a Tono-issued exit
catalog and signed traffic policy, then connect directly to the selected exit.
The Cloudflare Worker manages accounts and configuration; it does **not** relay
the user's traffic.

## Product and protection

- **macOS:** SwiftUI app with a privileged helper for PF, DNS and Core lifecycle.
- **Windows:** Tauri app with a privileged service for WFP, DNS and Core lifecycle.
- **Transports:** VLESS Reality and catalog-authorized Hysteria 2. Availability
  depends on the issued node configuration, not merely client support.
- **Protection:** OS-level fail-closed enforcement; no unprivileged sidecar
  fallback and no certificate-verification bypass.
- **Operations:** ops2 is the operator console, separate from the customer apps.

The current product Core is Tono's patched Mihomo. The sing-box/Go/gVisor
comparisons are experiments, **not a completed migration or release approval**.
Ubuntu desktop and the `tono` CLI are planned, not shipped products.

Tono is its own product. Reused components and license obligations are recorded
in [third-party notices](THIRD_PARTY_NOTICES.md); old privileged upgrade names
remain compatibility details, not the product identity.

## Start here

| Reader | Entry point |
|---|---|
| Contributor | [Contribution workflow](CONTRIBUTING.md) |
| Developer / build operator | [Build and test execution](docs/BUILD_AND_TEST.md) |
| Architecture reviewer | [System map](docs/architecture.md) |
| Release reviewer | [Ship gates](docs/SHIP_PLAN.md) and [release lines](docs/RELEASE_LINES.md) |
| Ops developer | [Ops plan](docs/ops/plan-2026-09-11.md) and [console](services/ops-console/README.md) |
| Coding agent | [Agent instructions](AGENTS.md) |
| Further documentation | [Document map](docs/README.md) |

## Development: edit locally, build on the right host

The maintainer's **MacBook is the editing and review machine**, not a second
macOS-and-Windows build farm. Native compilation, large test suites and
packaging belong on build workers; frontend fixtures and focused lightweight
checks can stay local.

The intended dedicated workers are **Mac Studio for macOS** and a **Windows
machine for Windows**. Mac Studio no longer serves as a residential exit.
Worker onboarding is tracked in the [execution guide](docs/BUILD_AND_TEST.md);
do not interpret this target layout as proof that self-hosted runners are live.
Existing GitHub-hosted CI remains in place while they are qualified.

This is a public repository. Untrusted PRs stay on isolated GitHub-hosted
runners, not persistent home machines with access to private networks or keys.
Native PF/WFP/DNS and installer qualification is a separate, controlled lane.

## Repository

| Directory | Purpose |
|---|---|
| [`apps/macos/`](apps/macos/) | SwiftUI client and privileged helper |
| [`apps/windows/`](apps/windows/) | Tauri app, service and portable Rust crates |
| [`services/control-plane/`](services/control-plane/) | Cloudflare Worker, D1 and static assets |
| [`services/ops-console/`](services/ops-console/) | Operator UI |
| [`services/exit-agent/`](services/exit-agent/) | VPS roster and metering |
| [`services/home-agent/`](services/home-agent/) | Residential-exit usage reporter; not a Mac Studio assignment |
| [`ops-panel/`](ops-panel/) | SSH quality collector |
| [`tooling/scripts/`](tooling/scripts/) | Build, test, release and operations tooling |

## Releases and evidence

A GitHub tag, a candidate installer or a green build is **not** proof of a
customer-channel release. The next customer publication is governed by
[SHIP_PLAN](docs/SHIP_PLAN.md); open protection and upgrade gates remain open
until the required evidence exists. Ops UI polish is not a customer ship gate.

`release/macos` and `release/windows` own their platform release lines. `main`
is the reviewed integration point and the only production Worker source.
Sparkle and `windows-updates` promotion remains an explicit, gated operation;
moving builds to another machine does not authorize publication.
