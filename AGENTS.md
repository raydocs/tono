# Tono — agent notes

Cloud-managed VPN. Clients authenticate to the control plane, pull a per-device
exit catalog and a signed traffic policy, then connect directly to VLESS Reality
nodes. The Worker is not on the data plane. Product identity is Tono, not Clash
Verge or LiquidClash.

Read [docs/README.md](docs/README.md) for the document map and
[docs/architecture.md](docs/architecture.md) for the system map.

Before reviewing code or fixing a bug, read
[docs/FINDINGS_LEDGER.md](docs/FINDINGS_LEDGER.md) to avoid re-reporting known,
fixed or refuted findings; update its rows in the same PR that you deliver.

## Two living plans

| Plan | Owns | Do not |
|---|---|---|
| [docs/SHIP_PLAN.md](docs/SHIP_PLAN.md) | Customer 0.0.73. Four gates (G1–G4) | Promote Sparkle `appcast.xml` or `windows-updates` while any gate is open |
| [docs/ops/plan-2026-09-11.md](docs/ops/plan-2026-09-11.md) | Ops console / control-plane ops | Treat ops leftover work as a customer-ship gate |

A PR that cannot name a ship gate or an ops task does not belong on the current
integration branch.

## Deployables

| Path | Role |
|---|---|
| `apps/macos/` | SwiftUI client + `tono-core-helper` (PF, DNS, sing-box) |
| `apps/windows/app/` | Windows GUI (Tauri). `pages/tono/` is the product shell |
| `apps/windows/service/` | Privileged service (WFP) |
| `apps/windows/crates/tono-core/` | Portable catalog, policy, connect FSM, auth |
| `services/control-plane/` | Cloudflare Worker, D1, static assets. Entry `src/index.ts` |
| `services/ops-console/` | Operator UI |
| `services/exit-agent/` | VPS Xray roster + metering |
| `services/home-agent/` | Home exit-node usage reporter |
| `ops-panel/` | SSH quality collector |
| `tooling/scripts/` | Build, release, provision, tests |

Do not merge macOS `Core/` into `Services/`. Do not merge `app/crates/` into
`crates/` in the same change as a logic split. The three Windows Cargo
workspaces stay separate.

## Hard rules

1. **No customer-channel publish** until SHIP_PLAN G1–G3 have evidence. Do not
   edit `services/control-plane/public/appcast.xml` or
   `services/control-plane/public/windows/latest.json`, or push `windows-updates`
   for a ship. Internal tags only.
2. **Protection must not loosen.** Fail-closed at PF / WFP. No
   `skip-cert-verify`. No unprivileged sidecar path.
3. **Catalog is Tono-issued only.** hy2 is a second block on the same node
   (` · hy2`), not a second identity.
4. **Leftover Clash Verge names** in the privileged path (`StartClash`, upgrade
   process sweep) stay until a dedicated cleanup. Do not rename them inside a
   product fix. Inventory: [docs/archive/reports/CLASH_VERGE_LEFTOVER.md](docs/archive/reports/CLASH_VERGE_LEFTOVER.md).
5. **One narrow regression per behavior.** Windows one `#[test]`, macOS one
   XCTest, Worker one `it`. Do not add table-driven suites to make a change look
   complete.

## Internal update record

Every internal delivery with code, configuration, build/test tooling or
release/acceptance changes must update [docs/INTERNAL_CHANGELOG.md](docs/INTERNAL_CHANGELOG.md)
in the same PR. Follow its entry template: separate fixes from features and
test/fixture corrections; record source/PR, actual verification, remaining
limits, and candidate identity or explicitly no new package. Link detailed
evidence instead of duplicating it. A green source PR is not a released build.
Do not create empty entries for read-only reviews or formatting-only edits.

## Verification

Run the smallest check that covers the tree you touched.
**Choose its execution host before running it.** The maintainer's MacBook is
the editing/review machine, not the default native build worker. See
[build and test execution](docs/BUILD_AND_TEST.md).

| Tree | Check |
|---|---|
| `apps/macos` | The XCTest target for the changed behavior; full suite only if the helper or connect FSM moved |
| `apps/windows` | `cargo test` in the workspace you edited (`app`, `service`, or `crates/tono-core`) |
| `services/control-plane` | `npm test` / the matching `test/*.test.ts` |
| `services/ops-console` | vitest for the file; Playwright only for a page flow you changed |
| Docs-only | No test run |

### Execution location (owner decision, 2026-09-14)

- MacBook: editing, review, fixtures, focused frontend/Worker checks and
  inspecting downloaded candidate apps. Do not automatically run `xcodebuild`,
  `swift build/test`, native `cargo build/test/check/clippy`, Tauri dev/build,
  Core builds or release packaging here. These commands recreate large caches.
- Routine CI stays on GitHub-hosted `macos-26`, `windows-2025` and
  `ubuntu-24.04`; the repository is public. Do not replace fixed OS labels with
  `latest` or register persistent home runners as part of ordinary CI work.
  `tono-build` remains retired.
- Mac Studio is **no longer a residential exit**. It and the Windows machine
  are native acceptance devices. Do not provision an exit or reuse an address
  or tag from an archived handoff. Device access does not prove qualification.
- If an exact check cannot run remotely, report it as not run and request a
  bounded local exception; do not silently fall back to MacBook compilation or
  call an untested change verified. Match evidence to the exact tested SHA.
- Public PR code must not gain persistent-machine or signing privileges.
  Keep privileged network/installer acceptance separate. Retain the
  disposable-host guard on the Windows candidate-install smoke; hosted
  Windows Server CI is not Windows 11 device acceptance.
- Do not install toolchains, sync build caches, remove active worktrees or
  delete retained evidence merely to make the default local command work.

Do not run `wrangler deploy`, `wrangler secret`, or `d1 * --remote` unless the
user asked to deploy.

## Git

- macOS: `release/macos`. Windows: `release/windows`. Control plane: `main`.
- `main` is the only production Worker source. See [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md).
- Do not `git add` files you did not change. Do not rewrite release-line history.
