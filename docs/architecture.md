# Tono architecture

Cloud-managed VPN. Clients authenticate to the control plane, pull a per-device
exit catalog and a signed traffic policy, then connect directly to VLESS Reality
nodes. The Worker is not on the data plane.

```
macOS SwiftUI          Windows Tauri           Ubuntu desktop (Tauri)
        \                    |                      /
         \                   |                     /
          \                  |                    /
           privileged runtime (helper / TonoService)
                    └── tono-core (Mihomo TUN) + OS kill switch
                                    ↑
                              tono CLI (planned)
```

## Deployables

| Path | Role |
|---|---|
| `apps/macos/` | macOS GUI + `tono-core-helper` (PF, DNS, Mihomo) |
| `apps/windows/app/` | Windows / future Ubuntu GUI (Tauri) |
| `apps/windows/service/` | Privileged service (WFP today; nftables for Linux) |
| `apps/windows/crates/tono-core/` | Portable catalog, policy, connect FSM, auth |
| `services/control-plane/` | Cloudflare Worker, D1, ops console. Entry is `src/index.ts`; extracted so far: `crypto`, `oidc`, `access`, `ops-timeseries`, `ops-usage-hours`, `errors`, `http`, `catalog-yaml` |
| `services/exit-agent/` | VPS Xray roster + metering |
| `services/home-agent/` | Tailscale home-exit reporter |
| `ops-panel/` | SSH quality collector |
| `tooling/scripts/` | Provision, release, helper build, tests |

## macOS and Windows code map

Product work on these two apps is the current architecture upgrade. Linux
nftables/CLI and further Worker splits wait until this map is real in the
tree, not only in this file.

### macOS (`apps/macos/Tono`)

| Folder | Means |
|---|---|
| `Views/` | SwiftUI screens |
| `Services/` | Product state, account, catalog, audits |
| `Core/` | Helper, Mihomo, PF/DNS, owned runtime |
| `Models/` | Value types |
| `Support/` | Formatting, profiles, small policy helpers |

`AppState.swift` holds published state. Domain extensions:
`AppState+Connect`, `+Catalog`, `+Proxy`, `+Subscriptions`, `+Persistence`.
Supporting value types live in `Models/`; isolated workers live in
`Services/Catalog/`, `Services/Persistence/`, and `Services/Diagnostics/`.
`ManagedCatalogIdentity` owns the stable catalog identifiers, so catalog validation
does not depend on `AppState`. Do not merge `Core/` into `Services/`.

### Windows (`apps/windows`)

| Path | Means |
|---|---|
| `app/src/` | React UI (`pages/tono/` is the product shell) |
| `app/src-tauri/src/tono/` | Product layer on `tono-core` + Service IPC |
| `app/src-tauri/src/core/` | Tauri/service glue (not WFP) |
| `service/src/core/` | Privileged WFP, DNS, Mihomo supervision |
| `crates/tono-core/` | Portable catalog, policy, connect FSM |

`tono/connection.rs` still owns the outer attempt, disconnect, switching,
monitoring, probes and DIRECT lifecycle. `connection/stages.rs` now owns
`run_stages`; `connection/transaction.rs` owns the shared deadline and cancellation;
`connection/failure.rs` owns stable error mapping. Health, decision tables and route
classification remain in `connection_health.rs`, `connection_plan.rs`, and
`connection_routes.rs`.

The stage module still has an explicit list of adapter imports from its parent:
this is an intermediate extraction boundary, not the final independent client
library. Next isolate cleanup/monitor/controller adapters without changing the
generation owner or privileged operation order. Do not merge `app/crates/` into
`crates/` in the same change as a logic split. The three primary Cargo workspaces
remain separate; shared dependencies must be tested in each consumer workspace.

Leftover Clash Verge UI (Monaco, subscription editors) stays until a
screen is proven unreachable. `LEGACY_*` on-disk cleanup stays.

### Sequence

1. Peel types out of `AppState.swift` / `connection.rs` (in progress).
2. Split those god files by domain (`AppState+Connect`, connect transaction).
3. Delete leftover Verge surfaces with no route (Monaco / unused base widgets done).
4. Linux nftables, CLI, further Worker splits.

See [upgrade execution status](ARCHITECTURE_UPGRADE_PROGRESS.md) for completed
commits, verification evidence and the remaining DAG. File extraction alone is
not completion of the architecture upgrade.

## Linux product (not shipped yet)

Two clients, one service:

1. **Ubuntu desktop** — same Tauri UI as Windows. Packaging lives in
   `app/src-tauri/tauri.linux.conf.json` and `packages/linux/`.
2. **CLI** — `tono login | connect | status | disconnect`. Uses `tono-core`
   and the service Unix socket. Does not start Mihomo itself.

Kill switch on Linux is nftables (not yet implemented). Until it exists, the
service refuses `StartClash` on Linux rather than connecting without a
barrier. No unprivileged sidecar product path.

## Release lines

| Ref | Owns | Publishes |
|---|---|---|
| `release/macos` | `apps/macos/**` | Sparkle / `tono-macos-…` |
| `release/windows` | `apps/windows/**` | `v<version>` + `windows-updates` |
| `main` | integration + services | production control plane only |

See [RELEASE_LINES.md](RELEASE_LINES.md).

## Do not

- Trust server YAML for DNS, TUN, rules, or the controller
- Rename installed helper ids (`com.raydocs.tono.helper`, `tono-core-helper`)
- Renumber or rename applied D1 migrations (including the `0016`/`0017`/`0018` filename collisions; see `services/control-plane/migrations/README.md`)
- Treat `IClashTemp` as a Verge leftover (it is Clash Meta YAML)
- Delete `LEGACY_*` upgrade cleanup of old Verge / LiquidClash paths
- Rewrite git history to drop `artifacts/`

## Current identity

Shipped names: `Tono.app`, `Tono.exe`, `tono-core-helper`, `tono-core`,
`TonoService`, `TonoPreferences`, events `tono://…`, errors `TONO_ERROR:`.

Ops is `https://admin.afk.ccwu.cc/ops/` (Cloudflare Access). Token CLI is
`/api/v1/admin/*`. The API host 404s `/`, `/index.html`, `/admin.js`, and
`/style.css`; those legacy token-admin files are not in the tree.
