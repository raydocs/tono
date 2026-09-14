# G3 — exclusive update-journal publication and local transactions

Scope: #181, a bounded part of #26. Base: `5d6f8c891408d7a775133b9b5e3f2154b8a15875`.
Branch: `fix/g3-journal-exclusive-write-20260914`.
No update feed, installer, privileged runtime, UIUX, dependency or schema change.

## Defects and repair

The shared `tono-core` writer opened the fixed `update-handoff.json.tmp` with
`File::create`, so concurrent writers could truncate the same inode and rename
one another's partial payloads. A pre-existing hard link at that scratch path
also caused an unrelated owned file to be overwritten. This writer is separate
from the install-helper writer repaired by #179.

The writer now exclusively creates a unique same-directory scratch inode,
flushes it, closes its handle, and uses the existing platform `fs::rename`
replacement path. On failure it cleans up only its own scratch file; it never
removes the previous durable journal to make replacement succeed. Historical
fixed-name scratch files are neither opened nor deleted. Unix new files use
mode 0600. Existing best-effort directory fsync behavior remains unchanged.

Unique scratch files alone do not prevent a stale commit from re-reading or
removing a newly prepared attempt. All public filesystem entry points now take
one process-local transaction mutex; the private store performs the entire
load/check/advance/save/remove sequence without re-entering that mutex. This
includes reads which prune terminal journals. The store never awaits or calls
back into App/Service state while holding the mutex. A poisoned mutex refuses
operations instead of silently continuing.

Public signatures, journal schema, phase graph, protected shortcuts, version
checks, failure retention and verified-commit predicates are unchanged. The I/O
implementation moved to a private `update_journal/store.rs` to keep transaction
boundaries explicit. Two existing persistence-failure tests now inject a failed
save rather than depending on a particular scratch filename.

## Discriminating evidence

| Check | Actual result |
|---|---|
| Two new tests on old code | Both FAIL: scratch hardlink overwrites sentinel; 48/64 concurrent writes fail |
| Three new regressions after repair | PASS: scratch alias preserved, complete concurrent publication, stale commit vs new preparation |
| Mutation removing only the commit transaction guard | Regression FAILS: 9/32 new attempts damaged; guard restored before final checks |
| Original 80-round standalone probe, current fixed crate | 320/320 writes succeed; 0/80 malformed journals; sentinel preserved (before: 41/80 malformed) |
| Four separate processes, same journal | 256 writes, no write/read errors; demonstrates byte publication without a shared in-process lock |
| Edited Windows core workspace on macOS | 243 unit + 10 integration + 3 new = **256 passed**, 0 failures |
| Mac-hosted Windows App consumer | `cargo test --locked -p tono-windows --features clippy --lib`: **479 passed**, 0 failures |
| Windows-target compile | `cargo check --locked -p tono-core --target x86_64-pc-windows-msvc`: PASS |
| Whitespace / dependencies | `git diff --check` passes; no manifest/lockfile changes |

Probes used only process-owned temporary files and removed their data. Stress
numbers are observations, not deterministic production failure probabilities.
The Windows-target check was compilation on macOS, not a native Windows run.
The App `clippy` feature bypasses packaging resources; it is not installed-app
qualification. Native Windows PR CI is the next check, not already claimed here.

Local logs and standalone probe sources:
`/tmp/tono-journal-exclusive-write-20260914/` (`red.log`,
`red-unguarded-commit.log`, `green-atomic.log`, `core-workspace-final.log`,
`app-consumer.log`, `windows-cross.log`, `probe-after.log`,
`process_probe.rs`, `process-probe.log`).

## Explicitly still open

The mutex is process-local. It is NOT an authenticated old-App/installer/new-App
handoff and does not serialize or authorize different processes' phase changes.
#26 still owns initiating identity, target package/version binding, Service/WFP
handoff receipts, lifecycle admission and native interrupted-install replay.
The independent installer writer still follows #179's separate gate contract.
Crash/power-loss durability and installed PF/WFP/DNS continuity are not certified
by these tests. No G3/customer-release gate is closed and no feed is promoted.
