# Build and test execution

Status date: **2026-09-14**. Supports SHIP_PLAN G1 native behavior and G3
protected-update qualification; this policy does not close either gate.

## Owner decision and current facts

| Item | Evidence / decision |
|---|---|
| Repository | `raydocs/tono` is **public** again by explicit owner decision; API and anonymous browser access verified on 2026-09-14. |
| Routine CI | GitHub-hosted `macos-26`, `windows-2025`, and `ubuntu-24.04` for portable/web jobs. Existing workflows retain these labels. |
| MacBook | Editing, review, fixtures, focused frontend/Worker checks and downloaded candidates; no default native compilation. |
| Mac Studio / Windows machine | Native acceptance devices, not required CI workers. Mac Studio's residential-exit role is retired. |
| Self-hosted runners | Not required or registered by this change. No home-machine dispatcher or connectivity workflow is introduced. |
| Retired controller | `raydocs/tono-build` remains private, archived, and Actions-disabled; do not register or dispatch there. |
| Publication safeguards | The earlier 2026-09-14 API readback showed main unprotected and no required-reviewer rules in release environments. This does not establish current enforcement or prove visibility caused it. Customer publication follows the conditions in [AGENTS.md](../AGENTS.md). |

This decision supersedes the earlier same-day proposal to register both home
machines directly to private Tono. Do not follow that obsolete onboarding
proposal or machine addresses in an [archived handoff](archive/README.md).

## Execution lanes

| Lane | Host | Boundary |
|---|---|---|
| Edit / review | MacBook | Git, docs, fixtures, focused frontend/Worker checks, browser review, remote logs and downloaded candidates. |
| Routine build / automated checks | GitHub-hosted runner | Source/toolchain pins and exact-SHA evidence; no implicit installer execution or customer publication. |
| Native acceptance | Recoverable Mac/Windows device | GUI, PF/WFP, DNS, crashes, install/upgrade/uninstall, adapters and sleep; separately authorized scenarios. |
| Signing / publication | Release workflows | Signed candidates (draft or prerelease, on no feed) may be built for G3 evidence. Customer publication waits for owner-recorded SHIP_PLAN G1–G3 evidence and follows [AGENTS.md](../AGENTS.md) and [RELEASE_LINES](RELEASE_LINES.md#customer-publish-g4). |

A hosted job can run native tests but does not replace installed-device
acceptance. `windows-2025` is Windows Server, not Windows 11; hosted Windows
runs with UAC disabled. Mac Studio does not prove laptop Wi-Fi/hinge/sleep
behavior. Record tested OS, architecture and scenario rather than claiming
all Mac/Windows devices are qualified.

**No silent local fallback:** `cargo check`/Clippy compile too. Tauri native
dev/build, Core builds, Swift builds and `xcodebuild` are not lightweight
checks. Do not run them on the maintainer's MacBook without a bounded
owner-approved exception. Missing remote evidence stays not run.

Windows frontend-only work can use `pnpm web:dev`; ops uses
`npm run dev:fixtures`. Install only relevant workspace dependencies.
Browser preview does not prove IPC, Service behavior or protection.
Docs-only edits require no product test suite or compiler.

## Reproducible hosted CI, not floating OS upgrades

`macos-latest` and `windows-latest` migrate to newer GitHub images over time.
Use the current fixed OS labels and review major-version upgrades separately.
Fixed OS labels still receive software updates: retain checked-in Rust/Go/Node
pins and inspect/select the Xcode/SDK version required by the workflow. The
macOS app currently needs the macOS 26 SDK.

1. Record the exact source SHA; remote main cannot verify uncommitted edits.
2. Push intended changes on a review branch only when authorized; do not add
   another agent's dirty files or broaden artifact scope.
3. Use current path-filtered CI. macOS and Windows CI also support manual
   dispatch on an authorized remote ref when the required check is missing.
4. Verify each run's head SHA, event, workflow and jobs. A branch can advance
   while queued; distinguish a PR merge SHA from its source head.
5. Download only needed artifacts/logs. Ordinary CI does not necessarily
   produce an installable app; candidate/release workflows are separate.

```sh
git status --short
git rev-parse HEAD
gh run list --repo raydocs/tono --commit <tested-sha> --limit 20
gh run view <run-id> --repo raydocs/tono \
  --json headSha,event,workflowName,status,conclusion,jobs
gh run view <run-id> --repo raydocs/tono --log-failed
```

Skipped jobs, compiled-out tests and zero-test runs are not qualification.
GitHub standard hosted runner usage is free for public repositories; larger
runners are paid. Manage artifact/cache retention and do not infer that every
GitHub-hosted resource is free.

## Public repository and privileged boundaries

- No persistent home runner registration is part of this plan. A future
  exception needs an explicit owner decision and a separate trust review.
- Public PR code must not acquire signing credentials or a persistent machine's
  local/network privileges. Do not execute PR source in a privileged
  `pull_request_target` workflow.
- Keep workflow token permissions minimal. Check release environment admission,
  reviewers and branch restrictions before signing or promotion; visibility
  alone is not a security boundary.
- The Windows candidate-install smoke intentionally rejects persistent/local
  workers. Preserve that disposable-host guard; use the separately reviewed
  [Windows acceptance path](WINDOWS_0_0_72_DEVICE_ACCEPTANCE.md) for real devices.
- System tests need out-of-band recovery and pre/post-state evidence. Restore
  PF/WFP, DNS, proxies, services and adapters; do not treat cleanup as release
  acceptance or run disruptive checks on an active customer connection.
- #171 endpoint fault injection and #26 installed-update replay stay open until
  their actual evidence is accepted under [SHIP_PLAN](SHIP_PLAN.md).

## Disk and evidence lifecycle

- Prefer hosted builds to new `/tmp/tono-*` native build trees on MacBook.
  Only download the candidate/logs needed for the current review.
- Cache keys include OS, architecture, toolchain, workspace and relevant
  lockfiles/configuration. Separate trusted/untrusted producers and
  signed/unsigned artifacts.
- Evict only inactive caches with a measured whitelist. Preserve dirty
  worktrees, unpushed commits, local configuration and unresolved evidence.
  Never blanket-clean `/tmp/tono*` or a running job's target.
- Keep candidate manifests and ship-gate evidence outside disposable caches;
  redact logs before attaching them to this public repository.
- Toolchain/Xcode removal is a separate owner decision, not cache cleanup.

## Official references

- [Runner images and latest migration](https://github.com/actions/runner-images)
- [Hosted runner environments and privileges](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Self-hosted runner security](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)

README is the entry point; this guide owns execution policy. Archived reports
retain historical evidence with superseding notices. Production deployment and
customer update-channel promotion follow the conditions in [AGENTS.md](../AGENTS.md).
