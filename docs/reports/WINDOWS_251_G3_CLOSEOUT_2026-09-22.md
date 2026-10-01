# Windows #251 repair and #26 automation / protocol decision

Scope: SHIP_PLAN G1 (#251), G3 (#26/#181). Base is the published tester
candidate [569ce865](https://github.com/raydocs/tono/commit/569ce8654f57e66f293cf4e443b5e0819b71912d).
Branch: `fix/windows-251-g3-closeout-20260922`.

The owner requested fixing #251, finishing #26 and completing what can be
automated. This change fixes the remaining #251 presentation race and extends
G3 automation. **It does not implement authenticated installer handoff or close
#26.** The remaining protocol/legacy-upgrade decision is explicit below; no
schema, Service authentication or installed-device policy is silently changed.
No merge, replacement package, customer feed or production deployment is part
of this delivery. The already published RC does not contain this repair.

## #251: Connect admission is later than the last status read

The prior repair rereads status after selection acknowledgement. Another window
can still start/finish Connect before this window's Connect IPC is admitted.
The backend correctly refuses the duplicate, but Servers treated `already
connected` as failure; Tray also treated `already connecting` as failure. Both
skipped the normal refresh, and Tray left its picker open.

The two views now share `services/server-selection.ts`. It keeps the fresh
idle-state check, catches only recognized duplicate/superseded **Connect**
refusals, and returns to each caller's normal refresh/close path. It never
retries Connect, invents Connected, or treats a Select/status failure as a
successful connection. Real Connect failures still surface. The recommendation
flow stays select-only; backend admission and protection are untouched.

Two rendered-view regressions hold Connect after the idle read and release it
with a competing-admission refusal. They also check the same-city path, actual
status-refresh calls, `role=alert`, Tray `aria-expanded`, and genuine-error
controls. The Servers control rejects Select with the same error text to ensure
the suppression is not applied around the entire operation.

Executed in the Linux Orb, working directory `apps/windows/app`:

```sh
pnpm exec vitest run src/pages/tono/servers.test.tsx src/tono-ui/TrayPanel.test.tsx -t 'another Connect wins'
# Before repair: 2 failed / 19 filtered; both failed because status was not refreshed.
pnpm exec vitest run src/pages/tono/servers.test.tsx src/tono-ui/TrayPanel.test.tsx
# After repair: 21 passed / 0 failed (14 Servers, 7 Tray).
pnpm typecheck
# tsc --noEmit; exit 0.
pnpm exec eslint -c eslint.config.ts --max-warnings=0 src/services/server-selection.ts src/pages/tono/servers.tsx src/pages/tono/servers.test.tsx src/tono-ui/TrayPanel.tsx src/tono-ui/TrayPanel.test.tsx
# exit 0.
```

These tests execute the actual React view and shared action code with mocked
IPC. They establish DOM/interaction behavior, not an installed Tauri session or
WFP. No appearance/layout change needs a new visual claim. The receipt tool
recorded command exit codes; its whole-tree fingerprint was unavailable, so
those receipts are not independently source-attested acceptance.

## #26: automated coverage added without changing the trust contract

The existing `only_verified_commit_can_remove_journal` regression now refuses
persistence at every pre-commit transition, verifies the prior file remains
byte-for-byte, then retries successfully. The existing final-commit refusal,
phase/crash replay, wrong-version and re-entry tests remain intact. This is
real temporary-file journal I/O with an injected failed write, not real process
crashes or an authenticated old-App/installer/new-App exchange.

Windows CI now explicitly runs `tono-core`'s journal **unit** tests in the
existing `windows-2025` App job. Cargo's Tauri consumer test command did not run
dependency unit tests. The existing atomic-write integration target stays.
The new step first enumerates three required regressions and refuses zero/missing
tests, then runs `cargo test --locked -p tono-core --lib update_journal::tests::`.
No extra runner, native toolchain installation, privileged fixture or signing
permission is introduced.

The workflow regression was run before the workflow edit:
`node --test tooling/scripts/tests/windows-ci-paths.test.cjs` produced 6 passes
and exactly 1 failure, `dependency unit tests currently execute only on Ubuntu`.
After the workflow edit, the same repository-root command passed all 7 tests
with 0 failures. Native execution evidence will come from the ordinary
branch/PR workflow; a YAML assertion is not a Windows test pass.

## Remaining #26 implementation is a protocol and legacy-upgrade decision

The actual installer writer explicitly validates JSON but does not authenticate
handoff ownership (`service/src/bin/install_service/update_journal.rs`). It
discovers AppData/portable/user journals, validates phase/version presence/time,
then advances the one unambiguous pending journal. That does not bind the
authenticated initiating Service session or verified target package.

Existing reusable contracts are `AuthenticatedSessionRequest`,
`require_active_session`, `OWNER_LIFECYCLE_LOCK`, the cancellation-safe App
privileged transition boundary, and Service-private persistent state/ACL helpers.
An existing active-owner record proves a session, not approval of an update.
An App-written phase, extra JSON hash, or process-local journal mutex must not be
renamed a trusted Service receipt.

**Proposed implementation, not an approved or implemented wire format:**

1. Add a versioned Service-owned update transaction in a small
   `service/src/core/update_handoff.rs`, with types/capability negotiation in the
   existing protocol structure and routes in `core/server`. Reuse owner/session
   authentication under the existing lifecycle lock. Bind a Service-issued
   attempt ID, authenticated owner and session generation, canonical installed
   target, verified installer/payload identity, expiry, and durable phase. Store
   it in the existing private Service state tree, not the user journal.
2. Make verified-package staging, prepare/quiesce and receipt publication a
   single cancellable/serialized lifecycle transaction. Service must observe
   Core stop, DNS restoration and retained protection before authorizing
   replacement. An old task must not quiesce or commit a newer owner. Explicit
   Disconnect/cancel must invalidate that transaction without erasing failures.
3. NSIS/install-helper must consume the exact protected transaction and compare
   actual staged package/component identities before any mutation. Do not scan
   all users to discover an initiating owner. A receipt ID alone is not a secret
   or sufficient authority; reject wrong owner, package, generation, expiry and
   replay. Persist consumption before replacement; retain recoverable failures.
4. The new App must authenticate the same update transaction and its actual
   installed identity to the Service before first-launch/resume. Commit only
   after the current runtime/protection convergence succeeds; failed persistence,
   old processes, rollback and restart must not relabel another attempt.
5. Keep user-visible schema-v1 journal evidence separate from Service authority.
   Do not silently promote a legacy `protectedHandoffRecorded` into a new trusted
   receipt or erase the old failure history.

**Compatibility decision requiring owner confirmation:** legacy App/Service
pairs cannot supply the new receipt. The recommended policy is to refuse
protected automatic handoff in that case and require a normal successful
Disconnect followed by manual installation. Protected/unknown state must remain
closed and retain diagnostics, not be auto-disarmed to get through installation.
Do not claim backward-compatible protected auto-update without a separately
designed and reviewed bridge. This changes the upgrade contract and needs
versioned IPC/persisted state; it is not a local UI fix to guess silently.

There is also old `core/updater.rs` cache-install code, but `core/mod.rs` does
not declare it and no call site references it. It is **not an active bypass in
this candidate** and was not changed. The active viewer calls plugin download
then `prepareUpdate` then install. Upstream updater 2.11.0 verifies bytes during
download, not raw `Update::install`; any future Rust-owned staging path must
preserve that trust boundary rather than trust a cached version string. Source:
[pinned updater implementation](https://github.com/tauri-apps/plugins-workspace/blob/6aa2854f314481a459be1189b02c65a2450789ab/plugins/updater/src/updater.rs).

## What can run automatically, and what cannot be claimed yet

| Check | Automated lane / actual boundary |
|---|---|
| #251 page + tray admission race | Vitest actual DOM with synthetic IPC; executed locally above. |
| #26 phase/write refusal, crash-phase replay and re-entry | Existing core regression names above; Ubuntu plus new hosted Windows unit-test step. No real crash or Service receipt. |
| #181 exclusive/atomic journal publication | Existing Windows `update_journal_atomic` integration target; real owned temporary files. |
| #249 NRPT release/uninstall failures | Existing Service tests `nrpt_restore_failure_keeps_release_closed_and_retryable` and `uninstall_does_not_report_dns_recovered_while_nrpt_restore_fails`; injected OS failure, not registry recovery proof. |
| #259 DNS-write network-event retention | Existing Service `a_real_network_change_during_dns_write_is_deferred_not_discarded`; real reconciler and synthetic callback/topology, not physical Wi-Fi/IPv6. |
| #241 recovery ownership | Existing App cancellation/teardown regressions; injected I/O/barriers, not installed replacement-session proof. |
| #171 exact-endpoint convergence | Existing App `failed_exact_endpoint_commit_recovers_instead_of_completing_the_switch`; injected final-arm failure, not packet capture. |
| WFP filter shape | Existing guarded real-engine test on disposable hosted Windows; does not prove installed update continuity. |
| Full new #26 receipt | Automatable once the protocol is approved/implemented: wrong-owner/target/replay/expiry refusal, every persisted transition failure, cancellation, replacement-owner races, restart and rollback. Not executed by this change. |

Physical Windows 11/macOS install, PF/WFP packet behavior, DNS recovery on real
adapters, sleep/wake, real-account receipt storage and protected old-version
upgrade still require recoverable authorized devices and exact-package evidence.
Do not remove those gates because synthetic/hosted checks pass. Do not rebuild
or promote the published RC merely to attach a green badge to this plan.
