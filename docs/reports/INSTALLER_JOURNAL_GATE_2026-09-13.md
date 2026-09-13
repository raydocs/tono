# G3: installer journal refusal must stop the outer replacement transaction

Baseline: `5d6f8c891408d7a775133b9b5e3f2154b8a15875`.
Related: [#26](https://github.com/raydocs/tono/issues/26), **not its closure**.

## Confirmed defects

- Installer journal read/parse/write errors were logged and discarded. The caller
  then stopped Service and replaced binaries without a saved InstallStarted.
- The phase-string reader accepted `{ "phase": "protectedHandoffRecorded" }`;
  an InstallStarted retry bypassed even expiry/schema validation. Multiple user
  journals could all be stamped as belonging to one installation.
- The privileged writer truncated a fixed `update-handoff.json.tmp`. A file-backed
  regression precreated that scratch name as a hardlink to an unrelated temporary
  file: the old writer overwrote that file. This is not a demonstrated installed
  Windows privilege escalation or PF/WFP leak.
- NSIS retries generic helper errors three times. Merely propagating an illegal
  phase error is insufficient: the first try can persist Failed, and the second
  interprets terminal evidence as no pending update and continues as a repair.

Five file-backed regressions failed before the repair, using a behavior-preserving
extraction of the original journal collector. Separate checks cover injected save
failure and the NSIS non-retryable refusal contract. No real Service or firewall
was used for these journal regressions.

## Changes

- Extract installer-specific validation/persistence into a small private module;
  no new IPC command, dependency or cross-workspace coupling.
- Require the current journal envelope, schema, version fields and consistent,
  unexpired timestamps before promoting or accepting an idempotent InstallStarted.
  Bound reads to 64 KiB and reject non-ordinary final entries. Preserve unknown
  optional JSON metadata. Shape/version-field validation is **not package binding**.
- Preflight all discovered paths before writing; deduplicate canonical aliases
  and reject multiple pending journals instead of advancing them all. Malformed,
  expired and ambiguous evidence stays unchanged. An illegal known transition
  saves Failed and returns a refusal. Missing and validated terminal journals do
  not invent an update; terminal evidence stays for diagnosis/manual repair.
- Create a unique sibling scratch with `create_new`, write and sync before rename.
  Windows reuses the existing replace + WRITE_THROUGH primitive (no reboot-deferred
  success). Failed scratch artifacts are not reused or truncated on a later try.
- Gate every `--replace-runtime` at installer entry under the repair gate, before
  core-pin publication, BFE/SCM changes and Service/runtime replacement, including
  the path where the old SCM record is absent.
- Journal refusal exits **76**. NSIS aborts that attempt without automatic retry
  and clears ServiceInstallAttempted, so failure cleanup cannot treat the refusal
  as a newly created Service to uninstall. Existing retry behavior remains for
  other helper errors. The installed App must prepare a new update after a refusal.

## Verification

- New journal regressions: five failures before repair, all five pass afterward.
- Installer target: **15 passed**, including existing phase/protection checks,
  missing-file behavior, metadata preservation, byte-stable re-entry, injected
  persistence failure and the NSIS exit-code/branch contract.
- Full Mac-hosted Service workspace: **375 passed, 0 failed, 0 ignored**.
- Windows-target `cargo check --locked --target x86_64-pc-windows-msvc
  --features standalone,client --lib --bins` passed on Mac. This is compilation,
  not Windows execution; native Windows CI is required before acceptance.
- First full local workspace invocation could not locate mock_binary because its
  integration helper expects the workspace-local target directory. The binary was
  already built in the shared CARGO_TARGET_DIR. Linking this worktree's ignored
  target path to that cache fixed the environment; original failure log retained.
- Final Windows-target/workspace offline checks encountered missing registry cache entries.
  Repeating with `--locked` and network access fetched only pinned crates and
  both checks passed; no lockfile/dependency versions changed. The offline failure log is retained.
- NSIS contract test inspects the real template; it does not execute an installer.
  makensis is unavailable locally. No installed upgrade or native WFP acceptance
  is claimed. No ops UI, customer version/feed, production deployment or host
  network configuration was changed.

Logs: `/tmp/tono-installer-journal-gate-20260913/` (red-io-and-scratch.log,
red-validation.log, installer-final.log, service-workspace.log,
service-workspace-retry.log, service-workspace-final.log, windows-cross-final.log).

## Still open / integration constraint

Discovery still visits legacy APPDATA/USERPROFILE/portable/Users candidates. A
single well-formed file does **not** authenticate the initiating SID, app-data
root, generation, target application version or installer payload. A malformed
unrelated user's journal can now conservatively refuse replacement; do not hide
this with skip-on-error or first-match guessing. Replace discovery with the
Service-owned, authenticated initiating receipt before claiming G3 complete.
The App's ProtectedHandoffRecorded latch is still not Service/WFP handoff proof.
File preflight also does not introduce a cross-process journal lock or solve
adversarial parent-directory races. Installed-device lifecycle/failure injection,
#171, and G1–G3 remain open; no customer release is authorized by these tests.
