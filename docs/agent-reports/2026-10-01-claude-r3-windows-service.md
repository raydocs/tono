# Round 3: Windows Service kill switch and DNS hunt (2026-10-01)

Hunter: Claude Opus 5.5. Base: origin/main `10ce26c9`.

Scope:

- `apps/windows/service/src/core/windows_kill_switch.rs`: arm, lock, release, the AI hold follow-up, the watchdog, startup reconcile, the emergency disarm;
- `core/dns/mod.rs` (`restore_protected`, `ensure_restored`, `initialize_status_cache`, the status watchdog) and the selective NRPT in `dns/engine.rs`;
- `core/selective_layer.rs` and `selective_fail_open.rs`;
- the Service IPC handlers that call them (`core/server/handlers.rs`, `server/mod.rs`: gates, release, SCM stop, `retire_expired_fresh_arm`);
- `bin/service.rs` startup order (`reconcile_startup_and_restore`).

Out of scope: open PR #1266 (startup retirement fail-open, merged as `7a1a3a5a` while this round ran).

Method: I read the code and followed callers and callees. Each candidate was checked against `node tooling/scripts/records.mjs findings`. Locally I ran only `rustfmt --check` on the changed lines. No native cargo and no network commands ran on this Mac, and there was no hardware run.

## Result

**One new P2, inferred from source (推导). It is fixed in #1275 (needs-hardware, no auto-merge, waiting for independent review).** Its sibling on the explicit Release route is open as #1274.

No new P0 or P1. Every automatic failure path I traced releases general traffic with the AI hold, except the cases below and the known open ones.

## Findings

| ID | Sev | file:line (main `10ce26c9`) | One line | Verdict |
|---|---|---|---|---|
| WIN-FRESH-ARM-RETIRE-BOOKKEEPING | P2 (推导) | `service/src/core/server/mod.rs:431-450` | The watchdog runs `retire_expired_fresh_arm` for an abandoned Connect, exhausted Core recovery and committed DIRECT expiry. After stopping Core it refused the release on a repair-gate I/O error or on a run-intent read/write failure. The watchdog retries every tick and `continue`s before the unhealthy release, so a persistent ProgramData ACL or AV-handle failure kept a non-strict machine Blocked. This is the same class as WIN-SCM-RETIREMENT-FAILURE-RELEASE and H-IPC-2. | fixed in #1275 (needs-hardware; privileged release path, so no auto-merge) |
| (issue #1274) | P2 (推导) | `service/src/core/server/handlers.rs:530,540,556`; `server/mod.rs:310,406` | The explicit `ReleaseKillSwitch` route refuses forever on `OwnerRollbackFailure::Bookkeeping` (the Core stop is confirmed and only the bookkeeping write failed). `StopClash` with release and SCM Stop already release on that failure. | real-unfixed: the refusal carries an explicit design comment, so it is left for review; issue #1274, needs-hardware |
| (BRICK-W5 family) | known | `windows_kill_switch.rs::retire_unverified_on_service_start` (`update::pending()` early return); `update.rs:42` | `pending()` reads a locked, unreadable or corrupt update store as pending. An unverified non-strict startup barrier is then never retired, and #1266 does not reach it. | already covered by open BRICK-W5 / #681 (update-store fence); not re-filed |
| (observation) | low | `windows_kill_switch.rs:318-330` (`note_core_recovery_exhausted`), `:460` (`queue_direct_expiry_retirement`) | Both require `owner_key.is_some()`. A restored legacy intent that predates `owner_key` gets no automatic release after Core recovery exhausts. That legacy state needs an upgrade straight from a pre-owner-key build while connected. | not filed; recorded here |
| (design, not filed) | known | `windows_kill_switch.rs:3065` (`disarm_unlocked`), `handlers.rs:523` | An explicit Disconnect or Release whose DNS restore cannot be proven keeps WFP armed (the DNS-before-disarm invariant). The documented exits are the degraded registry path, the Start-Menu Restore Network shortcut and `--emergency-disarm`. | existing design (M2 baseline, WIN-DNS-SNAPSHOT-DELETE-BLOCKS); no change proposed without an owner decision |

### Checked and found sound

- AI hold coalescing (`selective_layer::request`/`reconcile_blocking`). A newer apply or remove supersedes an in-flight one. `install_unlocked_for` removes the hold only after a proven install. The selective NRPT keys never touch the catch-all GUID.
- Ordering of `release_general_traffic_unlocked`, `release_unproven_wanted_session_unlocked` and `emergency_disarm_with`: DNS restore first (best-effort on automatic paths), then WFP removal, then the AI hold.
- `initialize_status_cache` does not turn a stale DNS snapshot into reconciliation without a wanted barrier.
- `authorize_write_for` and `authorize_takeover_for` are evaluated under `OWNER_LIFECYCLE_LOCK`, and `arm_bootstrap` re-checks the takeover under `WFP_OPERATION`. Release and disconnect routes do not depend on the App image proof (`39b091ba`).
- `restore_desired_state` refuses to replay a Core without a wanted barrier. That is what makes a release after a failed run-intent write safe.

## PRs and issues

| # | Kind | State |
|---|---|---|
| #1275 | fix PR (WIN-FRESH-ARM-RETIRE-BOOKKEEPING) | open, label needs-hardware, no auto-merge (independent review first) |
| #1274 | issue (explicit Release bookkeeping refusal) | open, label needs-hardware |

## Open risks

- #1275's test (`fresh_arm_expiry_releases_when_the_run_intent_cannot_be_retired`) runs only in hosted CI. It was not run against the old code.
- The repair-gate part of #1275 is `cfg(windows)` only. It reuses the #1229 predicate `installer_holds_repair_gate`, and no new test covers it.
- Nothing in this round was reproduced on hardware.
