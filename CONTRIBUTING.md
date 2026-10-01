# Contributing to Tono

Start with the [document map](docs/README.md), [architecture](docs/architecture.md)
and [agent instructions](AGENTS.md). Current changes must name a customer ship
gate or an ops task; a visual ops improvement is not a customer release gate.

## Choose the execution host first

Follow [build and test execution](docs/BUILD_AND_TEST.md). The maintainer's
MacBook is for editing/review and focused lightweight checks. Routine native
builds use the existing GitHub-hosted `macos-26` and `windows-2025` jobs.
Mac Studio and the Windows machine are for separately approved native
acceptance, not prerequisites for CI. Do not silently compile on the MacBook
when a hosted check is unavailable.

External contributors may use their own prepared native development machine
or the project's hosted CI. This repository is public; unreviewed PR code must
not run on persistent home machines or receive publication/signing secrets.

## Development entry points

| Area | Entry point / boundary |
|---|---|
| macOS | `apps/macos/Tono.xcodeproj`; use hosted CI or an explicitly approved native development machine, with the SDK required by `.github/workflows/macos-ci.yml`. |
| Windows | [Platform development](apps/windows/README.md#development) and [app checks](apps/windows/app/CONTRIBUTING.md). Preserve separate App, Service and portable-core workspaces. |
| Windows frontend only | In `apps/windows/app`, use `pnpm web:dev`, not `pnpm dev` (which starts native Tauri development). Browser preview is not IPC/Service qualification. |
| Ops console | [Console README](services/ops-console/README.md); use fixtures and an isolated port. |
| Control plane | [Worker README](services/control-plane/README.md); local checks alone do not authorize production deploy or remote migrations; the conditions in [AGENTS.md](AGENTS.md) do. |

Use each workspace's checked-in toolchain/package-manager pins and lockfiles.
Do not install native build tools or download Core/Service artifacts merely to
edit docs or review frontend code. Explicit local native debugging remains
possible, but first agree on its scope and cache budget.

## Verification and evidence

Run the smallest check for the changed behavior, on its assigned host. One
narrow regression per behavior; docs-only changes do not require compilation
or product test suites. Preserve existing test assertions and distinguish
behavior failures, screenshot drift and unavailable environments.

A PR should report:

- source SHA and changed paths; which gate or ops task it supports;
- actual host/OS/toolchain, commands and executed checks;
- failures, skipped/unrun checks and the relevant evidence or workflow run;
- candidate source/artifact hashes when an installable build was tested.

Remote tests do not see uncommitted local edits. Do not claim an unrelated
green `main` run verifies a branch. Do not commit another agent's files, build
caches, private credentials or unredacted diagnostic captures.

## Record each internal update

Add one entry file under [docs/changelog.d/](docs/changelog.d/README.md) in the same PR as
each internal code, configuration, build/test tooling or release/acceptance
delivery. ([docs/INTERNAL_CHANGELOG.md](docs/INTERNAL_CHANGELOG.md) is frozen history.) Use the template to distinguish fixes, new behavior, verification
and unverified limits. Record which exact candidate contains the change, or
say that no new package exists. Link detailed reports rather than copying
their evidence; preserve historical failures and source identities. Read-only
reviews and formatting-only edits need no empty entry.

## Branch and release ownership

macOS is released from `release/macos`, Windows from `release/windows`, and
reviewed changes integrate normally into `main`. Only `main` may deploy the
production Worker. See [release lines](docs/RELEASE_LINES.md) and
[SHIP_PLAN](docs/SHIP_PLAN.md) for immutable history, update-channel ownership
and release gates. Running a build or opening a PR never authorizes deployment; the merge, deploy
and publish conditions are in [AGENTS.md](AGENTS.md).
