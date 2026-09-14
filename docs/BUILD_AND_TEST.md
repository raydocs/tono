# Build and test execution

Status date: **2026-09-14**. Supports SHIP_PLAN G1 native behavior and G3
protected-update qualification; this policy does not close either gate.

## Current facts and pending work

| Item | Evidence / decision |
|---|---|
| Mac Studio residential-exit role | Owner confirmed retired on 2026-09-14. Do not restore it from the July handoff. |
| MacBook | Editing, review, fixtures and focused lightweight checks; native builds are remote-first. |
| Mac Studio / Windows machine | Intended native build/test workers. Access, hardware, tools and desktop sessions still need inspection. |
| GitHub | `raydocs/tono` is public; repository runner API returned `total_count: 0` on 2026-09-14. This says nothing about unrelated registrations. |
| Private controller | `raydocs/tono-build` created private on 2026-09-14; default workflow token is read-only and PR-approval permission is disabled. No runners registered yet. |
| Existing CI | macOS uses `macos-26`, native Windows uses `windows-2025`, portable/web jobs also use Linux. Unchanged. |
| Dedicated-worker cutover | Not qualified. No registration, installation or remote build has been performed by this change. |

The current workflow files, source/lockfiles and exact-run evidence are the
truth. Do not copy old addresses, tags, credentials or machine state from an
[archived handoff](archive/README.md) into runner setup.

## Execution lanes

| Lane | Host | Boundary |
|---|---|---|
| Edit / review | MacBook | Git, docs, fixtures, targeted frontend/Worker checks, browser review, remote logs and downloaded candidates. |
| Public PR | GitHub-hosted disposable runner | Existing CI; no access to persistent home workers. |
| Reviewed native build | Mac Studio / Windows, after onboarding | Compile, non-disruptive tests, candidate packaging; not automatic installation or publication. |
| System qualification | Recoverable native test environment | GUI, PF/WFP, DNS, crashes, install/upgrade/uninstall and adapter/sleep transitions; explicitly authorized scenarios. |
| Signing / publication | Existing protected release workflow | Separate credentials and approvals; SHIP_PLAN remains authoritative. |

MacBook may smoke-test a downloaded candidate without rebuilding it. Mac Studio
does not prove portable Wi-Fi/hinge/sleep behavior. VM results are not physical
adapter or physical-device sleep qualification.

**No silent local fallback:** `cargo check`/Clippy also compile. Tauri
`pnpm dev`, `pnpm dev:tauri`, `pnpm build`, Core builds, Swift builds and
`xcodebuild` are not lightweight checks. Do not run them on the maintainer's
MacBook without a bounded owner-approved exception. Report unavailable remote
checks as not run; never substitute an unrelated green run.

Windows frontend-only work can use `pnpm web:dev`; ops uses
`npm run dev:fixtures`. Install only the relevant workspace's dependencies.
Browser preview does not prove IPC, native service behavior or protection.
Docs-only edits require no product test suite or compiler.

## Interim path: existing GitHub-hosted CI

1. Record the exact source SHA. Remote `main` cannot verify uncommitted edits.
2. Prepare only intended changes on a review branch. Push/open a PR only when
   authorized, without adding another agent's dirty files.
3. Use current path-filtered CI. macOS and Windows CI also support manual
   dispatch on an authorized remote ref when the required check is missing.
4. Verify the run's actual `headSha`, event, workflow and jobs. A branch can
   advance while queued; distinguish a PR merge SHA from its source head.
5. Download only needed artifacts/logs. Ordinary CI does not necessarily upload
   an installable app. Candidate/release jobs have separate contracts.

Read-only inspection commands (replace the angle-bracket placeholders):

```sh
git status --short
git rev-parse HEAD
gh run list --repo raydocs/tono --commit <tested-sha> --limit 20
gh run view <run-id> --repo raydocs/tono \
  --json headSha,event,workflowName,status,conclusion,jobs
gh run view <run-id> --repo raydocs/tono --log-failed
```

Skipped jobs, compiled-out tests and zero-test runs are not qualification.

## Dedicated workers: onboarding sequence

### 1. Inspect, do not install or change networking yet

Record privately: access alias, OS/build, architecture, CPU/RAM, free disk,
tools, existing workloads, desktop-session availability and independent
recovery access. Keep addresses, credentials and registration tokens out of Git.

- Mac: match current CI's Xcode/macOS SDK. The app currently requires the
  macOS 26 SDK. Inspect `xcodebuild -version`, SDKs and test destinations rather
  than assuming the old Mac Studio signing/Xcode setup still applies.
- Windows: inspect architecture, MSVC/Windows SDK, Rust and WebView2. Use
  checked-in toolchain/package-manager pins and lockfiles, not “latest”. Keep
  App, Service and portable-core workspaces separate. x64 is not ARM64 coverage.
- Signing readiness is separate; ordinary jobs do not acquire release keys.

### 2. Establish the trust boundary before registering

Do **not** replace the public repository's `runs-on` with home-worker labels.
An approval label, separate OS user or clean checkout does not sandbox arbitrary
PR code. GitHub recommends private repositories for self-hosted workers and
warns that untrusted code can compromise persistent workers even in private
repositories. [Official security guidance](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners).

The private build-control repository is `raydocs/tono-build`, created for this
purpose. Keep access maintainer-only and protect/review its default branch;
branch-protection enforcement has not yet been qualified. **Machine registration
and native-build qualification are pending.** Public PR CI stays hosted.
Use the [registration instructions and read-only smoke template](../tooling/runner-control/README.md).

Only dispatch reviewed workflows for explicitly approved source SHAs from
`raydocs/tono`. Source build scripts are executable code too; private registration
alone does not make them trusted. Do not execute arbitrary fork workflows,
shell-command inputs, mutable branch substitutions or shared untrusted caches.
Start source-build qualification with a reviewed main SHA, not an arbitrary PR.

Use minimum token permissions and least-privilege build accounts. Keep private
network/production access and signing keys away from ordinary jobs. Prefer a
disposable VM/environment where stronger isolation is needed. Re-registering a
runner or checking out a clean tree does not reset a compromised OS.

### 3. Qualify before cutover

1. Register one machine at a time, run the read-only connectivity inventory,
   and verify host/architecture. It does not compile, install or certify tools.
2. Add a reviewed native-build workflow, one job per host initially. Run an
   unsigned build and narrow non-disruptive regression from an exact source SHA.
3. Repeat from a warm cache and prove changed source is rebuilt. Record peak
   disk, time, test count, toolchain and artifact hashes.
4. Upload scoped artifacts plus a manifest: source SHA, control-workflow
   revision, platform/architecture, toolchain, signature status, checks and
   SHA256. Never upload runner homes, private keys or whole worktrees.
5. Verify failures, timeouts, unavailable hosts and safe cache cleanup. No
   automatic MacBook fallback and no queued-job-as-pass reporting.
6. Make this the normal reviewed native-build path only after both workers
   pass. Preserve hosted public PR checks and protected release workflows.

Do not copy MacBook node_modules, target, DerivedData or keychains to bootstrap
a worker. Reproduce inputs from source/lockfiles and reviewed immutable artifacts.

## Native qualification stays separate

Mac Studio's retired exit role removes that old dependency, not the need for
permission before changing its installed app, PF/DNS, protection or rebooting.

- GUI tests need a verified interactive desktop and permissions, not merely
  a background service or SSH session. Keep build jobs separate.
- Run one disruptive scenario per host. Record app/Core/helper/service hashes,
  initial protection/DNS, observations and post-test recovery state.
- Recovery must not depend on the VPN being tested. A failed cleanup
  quarantines the host from new jobs; never automatically disarm protection to
  reconnect CI. A killed job may skip final cleanup, so startup must detect
  unresolved state before accepting another job.
- `test-windows-candidate-install.ps1` deliberately rejects local/persistent
  workers. **Keep its guard** and hosted execution. Native installed-machine
  acceptance uses the separately reviewed [Windows QA path](WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md).
- XCTest/Rust green does not close #171 endpoint fault injection or #26
  protected-update acceptance. Follow [SHIP_PLAN](SHIP_PLAN.md).

## Disk and evidence lifecycle

- Use worker-owned cache roots, not a new `/tmp/tono-*` build for every turn.
  Serialize shared cache writers or isolate concurrent jobs.
- Cache compatibility includes OS, architecture, toolchain, workspace and
  relevant build configuration/lockfiles. Separate trusted/untrusted producers
  and signed/unsigned artifact boundaries.
- Set volume budgets and free-space thresholds after measuring a clean build's
  peak use. Evict only inactive caches by age/size; prevent new jobs before disk
  exhaustion instead of deleting a running job's target.
- Keep candidate manifests, unresolved failure evidence and ship-gate evidence
  outside disposable caches. Set retention and redact private logs; a merged
  branch alone is not permission to delete its evidence.
- After remote checks/artifact retrieval work, clear idle MacBook build caches
  with a logged whitelist. Preserve dirty worktrees, unpushed commits, source,
  active fixtures and needed evidence. Do not blanket-clean `/tmp/tono*`.
- Removing Xcode/SDKs/toolchains is a separate owner decision, not cache cleanup.

## Documentation ownership

This guide owns execution policy, machine-role corrections and cutover status.
README is the public overview; CONTRIBUTING and AGENTS point here. Update the
dated status with actual worker evidence, not intended roles. Archived reports
keep their historic results with superseding notices. This migration does not
authorize appcast/update-channel promotion or production deployment.
