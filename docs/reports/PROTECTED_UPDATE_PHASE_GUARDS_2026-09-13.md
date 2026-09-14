# G3: unprotected update shortcuts require unprotected journal state

Baseline: `d769e134464e6fed7ed02c8f0c8eef05d122aa82`.
Refs [#26](https://github.com/raydocs/tono/issues/26); this is a narrow journal
correctness repair, **not** completion of authenticated installer handoff or G3.

## Confirmed defect

Both journal implementations allowed `CleanShutdownCompleted -> InstallStarted`
and `FirstLaunchMigration -> Verified` solely by phase name. Those shortcuts were
introduced for unprotected updates, but the instance's protection flags were not
checked. Windows' separate installer JSON writer also accepted the first shortcut
unconditionally. An interrupted protected journal at clean shutdown could thus be
stamped InstallStarted without a recorded handoff. A direct phase advance could
stamp Verified without going through ProtectionResuming.

This is a source/file-state reproduction, not a demonstrated WFP/PF release or
installed upgrade exploit. Existing higher-level commit/preparation checks already
reject some of these paths; they do not make the generic phase writers correct.

## Repair

- Clean shutdown may skip the handoff phase only if `keepKillSwitchArmed` is false.
- First launch may skip protection resumption only if both `wasConnected` and
  `keepKillSwitchArmed` are false. Protected Offline must not qualify.
- Both Swift `canAdvance` and `advancing`, and Rust `advance`, enforce these
  instance constraints. Existing refusal/evidence semantics remain unchanged:
  Windows records Failed; macOS retains the observed phase plus the refusal code.
- The separate Windows installer writer requires an explicit boolean false before
  accepting the clean-shutdown shortcut. Missing/malformed flags do not qualify.
- The existing Mac unprotected-sequence test incorrectly used protected flags;
  its fixture now represents a genuinely unprotected update.
- The living ship plan's version-check command now uses the script's actual
  `--expected` option, not the nonexistent `--expected-version` option.

No schema, IPC, driver, binary replacement ordering, customer feed, kernel or
implicit fallback change. The three Windows workspaces remain separate.

## Evidence

One new narrow regression per affected implementation: Mac journal, portable
Windows journal, separate Windows installer writer. All three failed against the
unmodified production logic, then passed with the guards. Failure is an assertion
about real phase/file state, not a compilation error. Unprotected controls remain
legal; a refused Windows shortcut retains failed evidence and cannot commit it.

- macOS `UpdateHandoffJournalTests` + `UpdatePreparationTests`: **24 passed**.
- Portable `tono-core`: **242 unit + 10 integration tests passed**.
- Mac-hosted Windows installer binary tests: **8 passed** (Windows-specific cases
  still require native Windows CI).
- Mac-hosted Windows App consumer: **479 passed**. Native CI must also pass
  before merge.

Logs: `/tmp/tono-update-phase-guards-20260913/{core-before,core-after,core-full,
macos-before,macos-after,service-before,service-after,app-full}.log`.
Tests touched only temporary fixture files, not installed PF/WFP, DNS or Core.

## #26 remains open

Phase guards are not a handoff identity. The installer still scans candidate user
journals, lacks an authenticated initiating identity/target binding and logs journal
write/read errors without making all of them fatal to binary replacement. Accepting
an already recorded phase is not cryptographic or Service-owned handoff proof.
Those owner/installer contracts and installed crash/persistence-failure replay must
be solved separately. Do not close G3 or publish customer updates on this evidence.
