# Handoff: Tono macOS + Windows architecture upgrade

> Historical input snapshot from the original working tree. The isolated upgrade
> branch has since recovered and committed it, fixed the macOS compile failures,
> and merged the recorded upstream changes. For current status, read
> [ARCHITECTURE_UPGRADE_PROGRESS.md](ARCHITECTURE_UPGRADE_PROGRESS.md).

For GPT Astra (or any follow-on): read this whole file before proposing
or executing a “complete upgrade.” The working tree is dirty and
**uncommitted**. Local `main` is **behind `origin/main` by 6 commits**.
Do not rebase or force-push. Do not mix this work with an origin merge
unless the owner asks.

Today’s date context: 2026-09-07. Source versions in tree: macOS and
Windows **0.0.72**. That is not a published installer claim.

---

## What this product is

Cloud-managed VPN. Clients auth to the Cloudflare Worker control plane,
pull a per-device exit catalog + signed traffic policy, then connect
directly to VLESS Reality nodes. The Worker is not on the data plane.

| Path | Role |
|---|---|
| `apps/macos/` | SwiftUI GUI + privileged `tono-core-helper` (PF, DNS, Mihomo) |
| `apps/windows/app/` | Tauri GUI (Windows; Linux packaging exists, not a shipped product) |
| `apps/windows/service/` | Privileged `TonoService` (WFP + DNS + Mihomo). Own Cargo workspace. |
| `apps/windows/crates/tono-core/` | Portable catalog / policy / connect FSM / auth (no Windows APIs) |
| `services/control-plane/` | Worker + D1 + ops console |
| `services/exit-agent/`, `home-agent/`, `ops-panel/` | VPS / home / collector |

Release lines (do not break):

| Ref | Owns | Publishes |
|---|---|---|
| `release/macos` | `apps/macos/**` | Sparkle / `tono-macos-…` |
| `release/windows` | `apps/windows/**` | `v<version>` + `windows-updates` |
| `main` | integration + services | production control plane only |

---

## Hard constraints (do not violate)

- Do **not** rebase / force-push published history.
- Do **not** rewrite git history to drop `artifacts/` (untracked from index already; pack still has old blobs).
- Do **not** rename installed helper ids: `com.raydocs.tono.helper`, binary `tono-core-helper`, launchd `com.raydocs.tono.core-helper`.
- Do **not** delete `LEGACY_*` upgrade cleanup: `liquidclash-helper` paths, `verge.yaml` dual-read, `.clash-verge-service-owner-token`, `verge-mihomo.exe` process sweep, Linux `clash-verge-service*` uninstall, PF leftover anchors.
- Do **not** treat `IClashTemp` as a Verge leftover (Clash Meta YAML).
- Do **not** rewrite serde field names like `verge_mixed_port`.
- Do **not** renumber/rename applied D1 migrations (prefix collisions `0016`/`0017`/`0018` — see `services/control-plane/migrations/README.md`).
- Do **not** rewrite bodies of `docs/archive/` or `docs/reports/` (banners only if needed).
- Linux: two clients (Ubuntu Tauri GUI + `tono` CLI) sharing one systemd `tono-service`. CLI must **not** start Mihomo itself. Kill switch is **nftables** (not implemented). Until then, Linux `StartClash` must **refuse** (fail-closed). No unprivileged sidecar product path.
- Splits so far are **behavior-preserving moves**. Do not “improve” adjacent logic in the same PR as a split.

---

## What is already done (this working tree)

Nothing below is committed unless the owner did it separately.

### A. Identity (Tono-only product names)

Live product names:

- App: `Tono.app` / `Tono.exe` / `Tono.xcodeproj` / `TonoApp.swift`
- Core sidecar: `tono-core` (not `verge-mihomo` in new payloads)
- Helper: `tono-core-helper` + pin-script identifier `com.raydocs.tono.helper`
- Service: `TonoService`
- Preferences type: `TonoPreferences` (`config/preferences.rs`, `cmd/preferences.rs`)
- Events: `tono://…` only; errors `TONO_ERROR:`
- Packaging gates reject leftover `verge-mihomo` sidecar names
- Prebuild tasks: `tono-core` / `tono-core-alpha`

### B. Repo hygiene

- `artifacts/` untracked from git index (history not rewritten)
- Dead macOS: `WebViewDownloader.swift`, `Resources/clash-fetcher`, `Tono/Tools/*`
- Dead Windows: `scripts/telegram.mjs`
- Old control-plane token admin HTML removed: `public/index.html`, `admin.js`, root `style.css`
- API host still 404s `/`, `/index.html`, `/admin.js`, `/style.css` with “This host is the Tono API”
- Live ops: `https://admin.afk.ccwu.cc/ops/` + `/api/v1/admin/*` token CLI
- Docs: `docs/architecture.md`, `docs/RELEASE_LINES.md` current source **0.0.72** (feeds in-tree still Sparkle 0.0.67 / Windows `latest.json` 0.0.34 — do not invent published status)
- Windows SECURITY/README no longer cite missing `docs/product-contract.md` / `docs/wfp-kill-switch.md`
- Empty ZWSP asset `DashboardMenuIcon` duplicate deleted

### C. Control plane (partial)

`services/control-plane/src/index.ts` **9285** lines (was ~9691).

Extracted modules: `crypto`, `oidc`, `access`, `ops-timeseries`, `ops-usage-hours`, `errors`, `http` (`parseBytesRange`), `catalog-yaml` (catalog text rewrite + `retirementCatalogPlan`).

Tests: `test/worker.test.ts` was 162/162 after the catalog-yaml extract.

`route()` (auth / ops / admin / home) is still inside `index.ts`. Further Worker split was **paused** so mac+win product code could be cleaned first.

### D. Linux (gate only, not a product)

`StartClash` on Linux is refused: “Linux kill switch is not implemented; refusing to start without a barrier.” Tests for that gate exist in `service/src/core/server.rs`. Packaging under `app/src-tauri/packages/linux/` is Tono-named leftover Clash Verge desktop GUI — keep, mark planned, do not ship as complete.

### E. macOS structure upgrade (in progress)

`TonoApp.swift` **1037 → 213**. Split out:

- `Tono/App/AppUpdater.swift`, `AppDelegate.swift`, `WindowConfigurator.swift`
- `Services/PhysicalNetworkReachability.swift`
- `Core/RuntimeCleanup.swift`

Theme tokens: `Views/Theme/TonoTheme.swift` (was in `NodeCardView`).

Clash Verge leftover copy in `SubscriptionManager` blockedByServer string rewritten.

`AppState.swift` **6948 → 2253** (class + remaining sleep/wake/settings/probes). Extensions:

| File | Lines | Owns |
|---|---|---|
| `AppStateSupport.swift` | 574 | types, catalog/policy processors |
| `AppState+Connect.swift` | 1794 | connect / disconnect / reconnect / monitor |
| `AppState+Catalog.swift` | 1123 | managed catalog + traffic policy |
| `AppState+Proxy.swift` | 680 | node/rule selection |
| `AppState+Subscriptions.swift` | 371 | Dev subscription CRUD |
| `AppState+Persistence.swift` | 181 | disk load/save |

Swift `private` on members used across these files was widened to **internal** (same target, not `public`). Xcode uses `PBXFileSystemSynchronizedRootGroup` on `Tono/` — new files auto-include.

**Not xcodebuild-verified** after the AppState extension splits.

### F. Windows structure upgrade (in progress)

Live UI routes are already Tono-only (`pages/tono/*` + settings).

Deleted 18 dead CVR frontend files (Monaco stack, `use-verge.ts`, unused `components/base/*`). Barrel now exports only `BaseDialog`, `BaseErrorBoundary`, `VirtualList`. Vitest 33 passed on layout/dashboard/update-viewer.

`connection.rs` **8862 → 8084**. Split:

| File | Lines | Owns |
|---|---|---|
| `connection_health.rs` | 287 | HealthLegs, classify_core_sample, kill-switch/DNS health |
| `connection_plan.rs` | 161 | FailurePlan, plan_failure, select_action, reconnect gates |
| `connection_routes.rs` | 365 | DIRECT sampling + residential route classify |

`connection.rs` still owns `run_stages`, disconnect, switch, probes, cloud DIRECT overlay apply.

Verified with `cargo test --manifest-path apps/windows/app/src-tauri/Cargo.toml --features clippy --lib` (clippy feature skips missing sidecar in Tauri `build.rs` on this Mac). Health / plan / route tests passed.

`tono/mod.rs` comment updated: Tono pages are the only UI; CVR **engine room** (sidecar manager, `IClashTemp`) is still compiled.

---

## What is still messy / not upgraded

### 1. God files that still dominate change cost

macOS (still >800 lines):

- `AppState.swift` 2253 (sleep/wake, settings, DNS/TUN probes)
- `ConfigPipeline.swift` ~2523 (owned YAML compiler; **zero MARK sections**)
- `AccountSession.swift` ~1436
- `LocalTrafficAudit.swift` ~1297
- `ProxiesView.swift` ~1131, `AccountGateView.swift` ~1098
- Helper **source** is outside the app: `tooling/scripts/core-helper/` (KillSwitchManager ~2635). Helper is a **git-tracked Mach-O**, not an Xcode target.

Windows app:

- `connection.rs` 8084 (`run_stages` + disconnect + switch + WFP/DNS probes)
- `tono/commands.rs` ~3647
- `core/service.rs` ~3065 (IPC **client**, name is confusing)
- `core/runstate/mod.rs` ~1432

Windows service:

- `windows_kill_switch.rs` ~5363
- `dns.rs` ~4780
- `server.rs` ~2379 (IPC still named `StartClash` / `StopClash`)
- `wfp_model.rs` ~2173, `install_service.rs` ~2019, `manager.rs` ~1795

### 2. Clash Verge engine room still compiled (Windows)

Pages are gone; this is still in the process:

- Sidecar fallback path (`runstate`, `dev:sidecar`, `CoreManager` sidecar)
- `IClashTemp` + `config.yaml` Clash draft initialized at startup (`Config::global`) even though connect uses `tono-core::config`
- sysproxy / PAC (`utils/server.rs`) unused as product path
- Three Cargo workspaces: `apps/windows/Cargo.toml`, `app/Cargo.toml`, `service/Cargo.toml`; `app/crates/` vs `crates/`
- Name leftovers (not serde): feature `verge-dev`, `dirs::verge_path()`, `init_verge_config_before_window`, tray id `verge_version`, locals `let verge =`
- IPC wire names `StartClash` / `ClashConfig` (keep if wire-compat required)
- monaco still in `package.json` / lockfile (source deleted)
- Extra locale dirs (product is en+zh)
- `service/resources/installer.nsi` ClashVerge template vs real `packages/windows/installer.nsi`

macOS leftovers:

- `SubscriptionManager` + `AddNodeSheet` / `AddRuleSheet` still exist and are wired (Dev subscription path). Product is catalog-only in production (`AppProfile.isDev` gates).
- `ClashConfig`, `ClashWebSocket`, `parseClashYAML*` — current Mihomo protocol, not dead branding.
- Folder lies: theme was in NodeCard (fixed); diagnostics still in `Support/`; `MockData.swift` still in Models and `loadMockData()` is a real AppState method.
- Two test universes: `TonoTests/` vs `tooling/scripts/tests` that splice production sources.

### 3. Linux product (not started beyond the refuse gate)

Need: nftables model (parallel to `wfp_model.rs`, unit-testable on Mac), systemd service already has a unit template, Ubuntu GUI = existing Tauri linux packaging, CLI `tono login|connect|status|disconnect` on `tono-core` + Unix socket. No Mihomo start from CLI.

### 4. Control plane

`index.ts` still ~9k. `route()` not split. D1 prefix collisions documented, not renamed.

### 5. Process / git

- **No commit** of this upgrade unless the owner asks.
- Local `main` **behind origin by 6**.
- macOS AppState extension split: **no xcodebuild** after the last peels.
- Full Windows `cargo test` without `--features clippy` fails on this Mac: missing sidecar `tono-core-aarch64-apple-darwin`.

---

## How work was done (so Astra does not fight it)

1. Identity first, then dead files, then **mac+win god-file peels**. Worker split and Linux nftables were deprioritized on purpose.
2. Method: **move code, do not change behavior**. Tests stay in `connection.rs` and `use super::` via `pub use` / `pub(crate) use` re-exports.
3. Swift extensions cannot see `private` members in another file — those members were made **internal**.
4. Parallel splits only on **disjoint files**.
5. Narrowest test first: vitest focused files; `cargo test --features clippy --lib -- <filter>`.

---

## What Astra should produce

A **complete remaining-upgrade plan** for macOS + Windows (Linux as a later gated phase), such that a new engineer can change connect / catalog / kill-switch without opening 5k-line files.

Please think through, then write:

1. **Target layout** for `apps/macos/Tono` and `apps/windows/{app,service,crates}` (folders + which remaining god file becomes which modules). Include whether to flatten the three Cargo workspaces.
2. **Phased DAG** (each phase: files, behavior-preserving vs allowed deletions, proof command, risk). Prefer finishing mac+win peels before Linux nftables and before more Worker `route()` splits, unless you argue otherwise with cost.
3. **Explicit delete list** vs **LEGACY keep list** for remaining CVR engine room (sidecar, IClashTemp, sysproxy, monaco npm, verge-dev feature, StartClash IPC).
4. **Verification matrix**: what can run on a Mac (this machine), what needs a Windows box, what needs xcodebuild.
5. **Integration / commit strategy** given dirty tree + 6 commits behind origin + release-line ownership. Do not recommend one giant commit that mixes macos and windows if release lines cannot take it.

Do **not** start coding until the owner accepts that plan. Do **not** propose rewriting WFP, serde port fields, helper identifiers, or D1 migration filenames as part of “cleanup.”
