# G1: a hot switch completes only after exact endpoint convergence

Baseline: `a2d7619e294269e3fdeed24b1b86aaa6175da71a`.
Tracks [issue #171](https://github.com/raydocs/tono/issues/171) and
[Orb Stage A A2-01](https://github.com/raydocs/tono/blob/7b7ad207d4bf4ceb7a7567ebc81c1e94c312e0e1/docs/reports/sing-box-evaluation/AUDIT.md).
These are source-confirmed P2/G1 defects, not a demonstrated arbitrary-traffic
fail-open or an installed-device fault reproduction.

## Repairs

- Both clients previously could keep Connected after failing to narrow temporary
  old + new endpoint permissions to new-only. Completion now requires that final
  operation to succeed. Failure retains requested selection intent, withdraws
  Connected and enters the existing keep-armed cold recovery owner. There is no
  disarm, new global mutex, new core or automatic protocol/city fallback.
- Windows rollback also used to ignore selector and old-only permission errors.
  A successful probe alone no longer certifies rollback: selector, probe and exact
  old-only replacement must all succeed. Otherwise recovery retries the requested
  node. Existing generation checks fence publication and recovery.
- macOS now treats an uncertain arm/selector/rollback result as a protection
  transition failure, rather than an ordinary error over a Connected session.
  The final completion boundary checks cancellation and protection generation.
  Recovery synchronously queues the existing disconnect owner; it does not await
  teardown from inside the switch task which teardown itself must drain.
- Pre-merge review found a real wake scheduling gap: wake increments generation
  before its queued disconnect cancels the switch. Sampling generation only at
  finalization can adopt that newer owner. The switch now captures generation at
  dispatch, carries it through both probes and checks it after awaits and before
  recovery/finalization. A retired finalization cannot start another arm operation.
- Adjacent Windows defect: the selection command saves the requested node before
  dispatch, but rollback previously restored only memory/UI. The next launch could
  silently reselect the failed node. Rollback now restores the existing selection
  file as well; a filesystem error is logged without misreporting the active node.

## Local evidence

One Windows regression covers failed endpoint convergence through the production
completion boundary and real connection FSM. Its injected recovery must run and
leave non-Connected, blocked protection with verified-session retry eligibility.
One macOS XCTest covers final-arm failure and a retired completion using the real
coordinator boundary. A separate macOS regression covers generation invalidation
before finalization, without relying on task cancellation. One additional Windows
file regression proves rollback is the selection read on next launch.

These tests inject the final operation; they do **not** install an endpoint union,
perform real selector/probe I/O, invoke an installed helper or inspect PF/WFP.

- Mac-hosted Windows App workspace: `cargo +1.98.1 test --offline --locked
  -p tono-windows --features clippy --lib` — **479 passed, 0 failed**.
- macOS full `Tono` XCTest scheme — **288 executed, 1 existing opt-in skip,
  0 failures**, including all **12** coordinator tests.
- Mutation checks: accepting a failed endpoint commit makes the Windows and
  macOS regressions fail; omitting the selection-file restore makes the file
  regression fail. All mutations were restored before the final full suites.
- The additional wake-generation regression fails with late generation sampling
  (three assertion failures) and passes after requiring the dispatch generation.

Local logs: `/tmp/tono-hot-switch-20260913/{windows-full,macos-full,
windows-mutation,macos-mutation,windows-selection-mutation}.log`.
Post-review macOS logs: `macos-generation-before.log`, `macos-final-full.log`.
Native CI must pass before merge. No host routing, DNS, firewall, installed helper,
production service or customer update source was changed to run these checks.

## Still required on installed Mac and Windows devices

1. Permit union and selector/probe succeed; inject final new-only replacement
   failure. Inspect non-Connected UI, requested-node recovery, actual endpoint
   removal and DNS continuity while the keep-armed owner tears down/restarts.
2. Fail the rollback selector or old-only replacement. Confirm the app does not
   certify rollback or leave Connected over an unproved endpoint set.
3. Race switch failure with explicit disconnect, another selection and recovery.
   Confirm retired work cannot repaint or restart after the newer owner releases.

Issue #171 remains open for this native acceptance. Passing unit tests/build CI
does not close SHIP_PLAN G1–G3, certify a release, or justify a sing-box upgrade.
