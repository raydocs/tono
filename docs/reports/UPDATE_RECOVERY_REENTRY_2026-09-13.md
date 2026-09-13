# G3: startup re-entry must preserve durable update recovery progress

Baseline: `fd6d7b5e10ea7259cef06ec965f63f2be5d49115`.
Related: [#26](https://github.com/raydocs/tono/issues/26), not its closure.

## Confirmed behavior

Windows `commands/restore.rs::restore_session` calls first-launch migration on
each account-restore attempt. macOS `AccountSession.performRestore` does so on
startup. If recovery already persisted `ProtectionResuming` and the process
restarts (or Windows account restoration is retried), both implementations ask
for `FirstLaunchMigration` again. That is a backwards transition:

- Windows persists Failed and returns an illegal-phase error. A subsequent
  verified connection cannot commit this failed update journal.
- macOS retains the phase but writes a spurious illegal-transition error and
  changes the evidence bytes. Its later recovery can clear that refusal; this
  is not the same irreversible Failed state as Windows.
- The same re-entry also mishandles a durable Verified receipt left behind by
  an interruption before commit. Both live recovery callers can then request
  another backwards hop to ProtectionResuming.

These are source/file-backed reproductions, not installed-upgrade or PF/WFP
fault injection. No observed traffic leak is claimed.

## Repair and boundaries

After the existing version check, first-launch migration returns the existing
FirstLaunchMigration, ProtectionResuming or Verified journal without rewriting
it. Other phases still take the original checked transition path. The old binary
still records `TONO_UPDATE_INSTALL_ABORTED`; failed/expired/corrupt evidence and
the existing phase graph are unchanged.

The Windows account-restore and macOS runtime-cleanup callers do not stamp
ProtectionResuming over Verified. They still perform live protection recovery;
the separate verified-connection path still owns protected commit. Startup does
not promote a phase, declare Connected, disarm protection or remove the journal.

No new installer/Service protocol, schema, dependency, kernel, implicit fallback,
ops UI, customer update feed or version-number change.

## Verification

One narrow file-backed regression per platform re-enters after ProtectionResuming
and Verified, checks byte-for-byte retention, then checks predecessor-version
refusal and that the resulting Failed journal cannot commit.

- Before the repair: the Rust test fails with `InvalidData: illegal update journal
  phase`; the XCTest fails four assertions about refusal/evidence preservation.
- After: macOS update targets **25 passed**; portable core **243 unit + 10
  integration passed**; Mac-hosted Windows App consumer **479 passed**.
- Full macOS XCTest: **290 executed, 1 existing opt-in skip, 0 failures**.
  Native Windows CI is recorded in the PR after completion.
- `git diff --check` passes. Tests use temporary journal files, not installed
  protection, DNS settings or production services.

Raw local logs: `/tmp/tono-update-reentry-20260913/` (`core-before.log`,
`macos-before.log`, `core-final.log`, `macos-after.log`, `macos-full.log`,
`app-full.log`). The first Rust invocation used the host's older default compiler
and was rejected before compilation; that environment-only result is retained
as `core-toolchain-precheck.log`. All actual Rust checks use installed `+1.98.1`.

## Still open

#26 still requires an authenticated initiating identity/target-bound installer
handoff, durable persistence-error handling, Service/WFP ownership proof, and
installed-device replay. This patch does not add file-level multi-process
transaction locking or solve those contracts. #171 still needs native endpoint
convergence failure injection. G1/G3 are not release-certified by these tests.
