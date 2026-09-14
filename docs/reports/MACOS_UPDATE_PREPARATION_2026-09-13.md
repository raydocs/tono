# G3: refuse a Sparkle continuation without completed preparation

Baseline: `1d00b581dffdd98e84821c8789eb0c46b7a21bed`.

## Confirmed live-path defects

`AppState.prepareForSoftwareUpdate` cancelled connection work before attempting
its journal write, skipped disconnect for Protected Offline, and wrote
CleanShutdownCompleted with `try?`. The preserving disconnect deliberately does
not restore protected DNS and can finish its Task after a stop failure.
`TonoSparkleDelegate` nevertheless wrote InstallStarted with `try?` and invoked
the continuation. Task completion and a local armed flag were not proof of
successful preparation. A new preparation also overwrote prior raw evidence.

## Correction

- Archive prior raw journal bytes before the new durable UpdatePrepared. An
  archive/write failure cannot cancel a healthy connection or replace evidence.
- Drain the existing disconnect sequence, including Protected Offline/reloads.
  The helper actor then performs a non-reentrant stop/status, DNS restoration,
  system-proxy cleanup and protection observation. No disarm is added. A protected
  handoff requires armed + wanted + live; an unprotected one requires all absent.
- Check connection generation around asynchronous cleanup. Persist each owner
  phase only after its operation succeeds; failure records Failed when storage
  permits, never a successful preparation.
- Reject Sparkle's continuation on preparation/persistence failure and keep a
  visible error. Finish the refused update cycle rather than retaining its
  continuation forever, so a subsequent update attempt is possible.

The veto uses the repository-pinned Sparkle **2.9.6**
(`ac2def288cbff5cfc7df3ffef6abdf45b72bcb0a`):
[`SPUInstallerDriver.m`](https://github.com/sparkle-project/Sparkle/blob/ac2def288cbff5cfc7df3ffef6abdf45b72bcb0a/Sparkle/SPUInstallerDriver.m)
checks `updaterShouldRelaunchApplication` before continuing an install, including
when the postponed block is invoked again. A false result requests abort through
`SPUCoreBasedUpdateDriver`. Both implemented delegate selectors are checked by
XCTest. This source/contract check is not an installed Sparkle upgrade exercise.

## Verification

- Three narrow XTests: failed quiescence vetoes continuation and permits a later
  retry; raw evidence survives preparation/archive failure; intent alone is not
  a live protection proof. All use temporary journals/fakes, not real PF/DNS.
- Mutation check: changing the new quiesce error propagation back to `try?`
  makes the DNS-failure test fail three assertions. The mutation was removed.
  This is a mutation check, not a claim that the new test existed on the baseline.
- Full local XCTest: **286 tests, zero failures, one intentional skip** for the
  opt-in install-script export test. No installed helper or host network changes.
- Full-suite execution exposed two existing tests searching for the English
  word `backup` in localized text. Both fail on the untouched baseline on this
  Chinese host. They now assert the exact localized backup-action resource;
  production wording and translations are unchanged (SHIP_PLAN G2 test evidence).

CI and installed-device qualification remain separate acceptance steps.
Windows installer-bound identity/target version and cross-process ownership
remain #26 work; this does not close G3. Interrupted/resumed Sparkle installation,
actual PF/DNS continuity, and a real old-version upgrade still need installed
Mac evidence. No version bump, feed promotion, production deployment or core
upgrade is included.
