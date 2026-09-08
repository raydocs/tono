# Architecture upgrade execution status

This is an **incremental implementation**, not a declaration that the complete
upgrade or any product release is finished. Source version numbers and test
counts are not evidence of a published installer.

The 0.0.72 stability handoff is now tracked in
[STABILITY_0_0_72.md](STABILITY_0_0_72.md), including the verified source backup,
bounded connection-queue corrections, current test logs and native/privileged
qualification gaps. The original architecture DAG remains incomplete.

## Recovery and history

- Original source: the owner's dirty `main` working tree at `d07b127`.
- Implementation: isolated feature worktree; the original files/index and actual
  release branches are not modified. Ignored dependency/build caches may be reused.
- Recovery verified 164 changed paths, including 23 untracked files. The backup
  under the common Git directory's `tono-upgrade-backups/20260907-185559` includes
  the original index, staged/unstaged/final binary patches, untracked archive,
  SHA-256 manifest and artifact index-removal list. Unchanged/deleted artifact
  content remains recoverable from the recorded base; existing artifact files
  were not deleted.
- `origin/main` was fetched and remained `b73ab0e` (six commits beyond the original
  baseline). A separate normal merge preserves its Welcome/UI changes.
- No rebase, force-push, history rewrite, deployment, update-feed advancement,
  privileged helper installation or firewall modification is performed here.

| Commit | Responsibility |
| --- | --- |
| `ff4f73c` | Stop tracking generated artifacts; keep files and history |
| `ea4d9e8` | Recover macOS identity/splits; fix cross-file visibility; add compiled-module tests |
| `51644ee` | Recover Windows identity, compatibility and initial health/plan/routes splits |
| `2c5fd57` | Recover Worker catalog/HTTP extraction and legacy admin asset removal |
| `e129046` | Preserve source handoff and architecture/release documentation |
| `87b2907` | Ignore dependency-cache symlinks in isolated worktrees |
| `4872094` | Preserve Linux's fail-closed StartClash gate as its own commit |
| `e850d75` | Merge upstream separately; port Welcome gate to TonoApp and new tokens to TonoTheme |
| `4fe8a0c` | Give macOS catalog, persistence and diagnostics workers explicit domain ownership |
| `de0328d` | Extract Windows stages/failure/deadline; add six deterministic deadline/cancellation tests |

These are recovery/integration commits on a feature branch, **not release-line
promotion**. Before promotion, prepare and test each platform's reviewed changes
on its release line and integrate using normal merges. Do not cherry-pick an
opaque integration tip or overwrite a release-line source tree wholesale.

## Approved decisions and remaining DAG

```text
P0 recovery -> P1 compiling/tested baseline -> P2 upstream/release integration
  -> M1 macOS domain boundaries -> M2 helper/test structure -----------------+
  -> W1 App modules -> W2 Service modules -> W3 client/CVR exit -> W4 build -+-> D desktop acceptance
                                                                            -> C1/C2 Worker domains/acceptance
                                                                            -> L1 nft model/protocol
                                                                               -> L2 Linux Service
                                                                               -> L3 GUI/CLI
                                                                               -> L4 Linux acceptance
```

| Phase | Status and remaining acceptance work |
| --- | --- |
| P0 | Complete: independently recoverable backup and verified isolated restoration |
| P1 | Local baseline passes; Windows-native and privileged Mac qualification remain outstanding |
| P2 | Upstream feature-branch merge complete; release-line preparation/promotion not performed |
| M1 | Partial: ConnectionCoordinator owns tasks/generation; ConfigPipeline, AccountSession and LocalTrafficAudit have domain files. AccountGateView/LoginView/AccountGateSupport and ProxiesView+Nodes/+Chrome extracted. connect/disconnect method bodies still live on AppState+Connect (a body-move was reverted after implicit-self breakage) |
| M2 | Helper PF, lifecycle tests, CoreManager, HTTP, power gate, and SocketServer are separate sources. Protocol is 3.15.0; compile and CONTRACT hash share one source-file manifest in `build-core-helper.sh`. Helper rebuilt. |
| W1 | Partial: connection.rs is a facade over domain modules; commands split by domain; `core/service/` is install/owner/IPC/tests. `tono-service-client` crate not extracted (W3) |
| W2 | Partial: Service DNS engine is `dns/engine.rs`; WFP tests/real-engine tests are siblings; IPC `server/handlers.rs` holds `create_ipc_router`. Remaining DNS restore/enable and WFP engine/filter bodies still large |
| W3 | Not started: tono-client/service-client crate extraction and CVR runtime-path retirement |
| W4 | Monaco removed from package.json, lockfile, and theme CSS; locale loading constrained to en/zh with fallback tests. Unused leftover locale JSON files remain on disk but are not loaded |
| D | Not accepted: desktop structure and native/privileged qualification incomplete |
| C1/C2 | Partial: Env/auth/catalog/home/product-account/traffic-policy extracted from `index.ts`. Router still in `index.ts`. Worker typecheck + 328 tests pass. Not a deployment acceptance |
| L1–L4 | Deferred; Linux remains fail-closed and is not a usable/shipped VPN product |

Locked decisions:

- Keep the three main Cargo workspaces and independent plugin verification.
  Do not flatten resolver/profile/feature/lockfile boundaries during code moves.
- Keep Swift native on macOS. AppState becomes a UI projection/composition root;
  connection task ownership must move to one coordinator rather than duplicate
  mutable state across more extensions.
- Keep macOS Dev subscriptions isolated. Windows/Linux GUI and development
  builds use the privileged service; eliminate GUI-spawned Core fallback only
  in a separately tested behavior-change commit.
- Linux CLI `connect` is foreground and maintains monitoring/refresh; only the
  systemd service starts Mihomo. Unexpected client death must not open direct
  traffic. GUI/CLI share one service with one active orchestration owner.
- Worker and Linux can proceed independently after desktop acceptance; neither
  belongs in a macOS/Windows structural-move PR.

### Next implementation slices

1. M1 remaining: move connect/disconnect/reconnect method bodies onto
   ConnectionCoordinator through narrow dependency/state interfaces (AppState
   keeps thin forwards). Deferred-connect identity and serialized disconnect
   ownership now live there; a bulk property-prefix transform is not a boundary.
2. W3: move Tauri-independent orchestration to `crates/tono-client` and IPC to
   `crates/tono-service-client`, with injected status/platform interfaces. Keep
   wire adapters and App command/event names compatible.
3. Retire sidecar allowance/spawn/PAC and obsolete draft writes only after their
   replacements pass tests. Preserve packaged Core payloads, old mixed-port
   migration, sysproxy cleanup and authenticated window/scheme control endpoints.
   `IClashTemp` is protocol data, not a branding match to delete blindly.
4. Worker: continue extracting the fetch router after domain services. Do not
   rename D1 migrations or resurrect legacy admin assets.
5. Linux: implement/test the nft model, capability-gated service, DNS recovery,
   Unix peer ownership, foreground CLI and Ubuntu `.deb` packages. Real VM
   qualification precedes enabling connections or public release planning.
6. Desktop acceptance (D): Windows-native, real WFP, signed helper install,
   `test-macos-all.sh`. Not claimed from this Mac.

## Verification evidence

Code checkpoint: uncommitted M1/M2/W1/W2/W4/C1 work on top of `de0328d`;
command output is retained under the ignored local
`artifacts/architecture-upgrade/` directory. Helper protocol is 3.15.0.
Run commands from the feature worktree, not the original dirty source directory.
Rust on this Mac uses explicit `+1.98.1`; the default installed Rust is older
than the workspace floor.

| Check | Local evidence |
| --- | --- |
| macOS Debug build | Passed after repairing seven supporting types and three cross-file members |
| macOS XCTest after ConnectionCoordinator | 185 executed, 0 failures, 1 intentional script-emission skip |
| New macOS tests | Provider ordering/target preservation; traversal/symlink refusal; process cancellation registration; reconnect delays 2/5/10/20/30; coordinator generation ownership |
| App Rust (`--features clippy --lib`) | 421 passed after cleanup/controller/probes/monitor extraction, including six paused-clock tests |
| Service (`--features standalone,client,test --lib`) | 305 passed on Mac; platform/model coverage, not real Windows WFP |
| Worker typecheck/full Vitest | Passed; 328 tests across eight files |
| Windows frontend | Typecheck, full Vitest, and 84 dev-control/packaging tests passed after upstream merge |
| Policy signing contract | 4/4 passed; trust key, context and protected host set unchanged |
| Multi-exit fixture | Both selected exits validated by bundled Mihomo |
| Body-equivalence check | `run_stages` byte-identical before formatting apart from visibility; moved Swift bodies identical except stable catalog identity alias |

The skipped XCTest is `HelperInstallScriptTests.testEmitInstallScriptWhenRequested`
(no `TONO_EMIT_INSTALL_SCRIPT` requested). It is **not** evidence that the
signed-helper install lifecycle was tested. Worker tests warn that production
Access environment settings are absent; they test fixtures, not deployment setup.

Discriminating commands:

```sh
xcodebuild -project apps/macos/Tono.xcodeproj -scheme Tono \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  CODE_SIGNING_ALLOWED=NO test
tooling/scripts/test-macos-all.sh
cargo +1.98.1 test --locked --manifest-path apps/windows/Cargo.toml -p tono-core
cargo +1.98.1 test --locked --manifest-path apps/windows/app/src-tauri/Cargo.toml \
  --features clippy --lib
cargo +1.98.1 test --locked --manifest-path apps/windows/service/Cargo.toml \
  --features standalone,client,test --lib
(cd apps/windows/app && pnpm typecheck && pnpm test && pnpm test:dev-control)
(cd services/control-plane && npm run typecheck && npm test)
```

Before desktop acceptance, additionally run Windows-native App tests and a real
installer; Service integration tests and
`cargo test --locked --features standalone,client --lib core::wfp::real_engine_tests -- --nocapture`
on an administrator Windows machine; Release Xcode build and isolated privileged
PF/helper/install qualification on Mac. Placeholder payloads and `clippy` feature
builds cannot substitute for these gates. Linux requires actual Ubuntu VM network
and installation tests; a Mac model test cannot enable the product.

## Immutable boundaries

Keep helper IDs/binary/launchd identity, LEGACY cleanup and dual-read paths,
serde/wire names including StartClash/StopClash, D1 applied migration names,
third-party notices and archived report bodies. Preserve source release ownership
and immutable tags. Failures must retain the existing protection semantics; only
the explicit release flow may restore direct connectivity. Do not claim this
upgrade complete by deleting tests, relaxing guards or only moving line counts.
