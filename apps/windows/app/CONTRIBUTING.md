# Contributing to the Tono Windows app

This is Tono's app workspace, not the upstream Clash Verge Rev contributor
entry point. Upstream license/attribution remains intact; Tono's product,
service and release boundaries are defined by the repository.

Read [root CONTRIBUTING](../../../CONTRIBUTING.md),
[AGENTS](../../../AGENTS.md), [execution policy](../../../docs/BUILD_AND_TEST.md)
and [Windows development](../README.md#development) first.

## Frontend-only checks

Use the package-manager version pinned in `package.json` and its lockfile.
From `apps/windows/app`, install only when frontend work needs dependencies:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test -- <changed-behavior.test.ts>
pnpm web:dev
```

The test filename is a placeholder for the narrow test you changed. Browser
preview does not verify Tauri IPC, service authorization, WFP or DNS. Preserve
existing i18n keys and run the project's `pnpm i18n:types` when changing locale
keys. Do not use a broad auto-fix/format command on unrelated files.

## Native execution

- Use the existing GitHub-hosted `windows-2025` CI for routine native checks;
  Windows device acceptance is separate. The maintainer's MacBook does not
  default to native Rust checks, Tauri dev/build or Core downloads.
- Match the checked-in Rust toolchain and CI's MSVC/SDK setup. Do not replace
  toolchain defaults globally or upgrade dependencies to bootstrap a review.
- App, Service and portable-core Cargo workspaces are separate. Run the narrow
  check in the relevant workspace with its actual CI prerequisites.
- `pnpm dev` and `pnpm dev:tauri` invoke native development. `pnpm dev:service`
  changes service installation and is not frontend setup. No sidecar fallback
  is accepted for Tono's product protection path.
- `pnpm prebuild` resolves native artifacts; `--force` replaces them. Do not
  run it on the editing laptop merely to make a browser preview work.
- A cache reset is a reviewed, inactive-directory cleanup; there is no
  `pnpm clean` script in this workspace. Do not invent a destructive substitute.

## Review evidence

Name the ship gate/ops task, exact source SHA, execution host, commands and
actual results. Distinguish unavailable native checks from passed ones; do not
count compiled-out or zero-test suites as coverage. Refer to the root workflow
for privacy, release approval and preserving other contributors' changes.
