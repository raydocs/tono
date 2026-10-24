# T5 Windows — telemetry-first scoped delivery

## Source and reproducibility

- `git fetch origin` completed; latest `origin/main` remained `322f48c6fcb13b26279fed22ae19f79dcc2522bb`.
- RED commit: `22419bce6`; classifier moved unchanged into the portable outbox module, then regressions added.
- GREEN implementation: `eef0b68ac`; no firewall, DNS, Core, authentication, IPC or routing mutation.
- Host: MacBook, installed rustc 1.97.1. Manifest requires 1.98; **no toolchain installed**. Portable command explicitly uses `--ignore-rust-version`; this is not evidence of a supported Windows/Tauri build.

```sh
cargo test --manifest-path apps/windows/Cargo.toml -p tono-core --test telemetry_outbox --ignore-rust-version -- --test-threads=1
```

[RED raw output](telemetry-red.log): 3 passed, 2 failed. The real classifier rejected `ApiError::RateLimited`; enqueueing ordinary traffic removed the unacknowledged `p0` report. Neither is a compile failure or skipped test.

```sh
cargo test --manifest-path apps/windows/Cargo.toml -p tono-core --test telemetry_outbox --ignore-rust-version
```

[GREEN raw output](telemetry-green.log): 7 passed. Tests include the same two behaviors, legacy mixed-file P0, timeline opt-out, deterministic barrier-controlled simultaneous producers, cap and acknowledgement/backoff. The integration test includes the actual shipped outbox source; it does not reimplement it. Temp directories use an atomic suffix because parallel tests can see identical wall-clock ticks.

## PR coordination (read-only)

- #1733: OPEN, draft, MERGEABLE; `ci-gate` success [39973037208](https://github.com/raydocs/tono/actions/runs/39973037208). DNS broker/engine, process, release worker paths. No unresolved review threads or CHANGES_REQUESTED at inspection.
- #1668: OPEN, draft, MERGEABLE; `ci-gate` success [39033872734](https://github.com/raydocs/tono/actions/runs/39033872734). Installer, packaging tests, install/uninstall executors and update paths. No unresolved review threads or CHANGES_REQUESTED at inspection.
- #1643: OPEN, draft, CONFLICTING. Service `server/{handlers,mod,owner_lifecycle_tests}.rs`, release and WFP owner-intent paths. This delivery does not touch those paths.
- **No file overlap** between this telemetry delivery and any of those three PRs; no commits pushed to their branches. Win10/11 acceptance for #1668/#1733 remains with the coordinator.

## Explicitly not fixed in this delivery

The requested T5 scope is not complete. These remain open, not silently marked in-PR:

- `WIN-MISSING-UPLINK-GRACE`, `WIN-DIRECT-BINDING-UNPROVEN`: distinguishing reliable absence from unanswered API reads and preserving independent Core/WFP/DNS/owner failures needs its own state/recovery change and controlled tests. No timeout or release policy changed here.
- `WIN-RESUME-RECEIPT-RACE`: no new IPC receipt or old/new Service pairing tests; requires coordination with #1643's ownership contract before changing it.
- DIRECT rollback PID baseline: still missing adoption on the error and full-tunnel rollback paths in `connection/direct.rs:1884-1897,2025-2036`. The current IPC wrapper returns `Result<()>`, not CoreIdentity (`core/service/mod.rs:1355-1380`), so a correct fix must prove a fresh same-owner/session snapshot rather than invent a returned identity.
- `release_general_traffic`: stop/release order, desired-state retirement and App's false-connected outcome remain unfixed (`service/src/core/sing_box_direct.rs:192-204`). Retiring the owner must coordinate with #1643; do not land an unreviewed partial reorder that leaves desired Core replayable.
- All optional P2 items (unarmed probe, tray countdown, rules modal, route accessibility, installer scratch cleanup and update UX) were left untouched to keep this first independent P1 delivery small. Installer/update paths belong to other in-flight work.

## Not run / release limits

- Full Tauri/App and Service suites on Windows: not run locally (Windows-only service/WFP APIs; installed Rust below manifest minimum); hosted ci-gate pending when PR is opened.
- Frontend pnpm suite: not run; no frontend edits, dependencies not installed for this worktree.
- Real HTTP 429, queue behavior across forced process/disk failure, Windows WebView2 and installed Win10/11: not verified.
- Wi-Fi slow resume, disabled NIC, roaming, sleep and concurrent recovery: not verified; no claim that this delivery fixes those flows.
- No feed, migration, signature, deployment script, server, release gate checkbox or customer update source touched. No deploy/package/publish/auto-merge.
