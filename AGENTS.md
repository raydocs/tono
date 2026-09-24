# Tono — agent notes

Tono is a cloud-managed VPN; clients pull a signed catalog and policy, then dial VLESS Reality nodes.
Maps: [docs/README.md](docs/README.md), [docs/architecture.md](docs/architecture.md) (deployables,
code map, do-not list). [docs/SHIP_PLAN.md](docs/SHIP_PLAN.md) owns customer 0.0.73 (gates G1–G4);
[docs/ops/plan-2026-09-11.md](docs/ops/plan-2026-09-11.md) owns ops work (not a ship gate). Every
PR names one ship gate or one ops task.

## Invariants (never loosen)

- Fail-closed at PF / WFP. No `skip-cert-verify`. No unprivileged sidecar path.
- The managed catalog holds Tono-issued exits only; ` · hy2` is a second block on the same node,
  not a second identity (`services/control-plane/src/catalog-yaml.ts`).

## Finish the work (owner decisions, 2026-09-24)

These conditions are the approval: when they hold, act; do not stop to ask.

**1. Merge** with `gh pr merge N --merge` when all hold:
- CI is green on the exact head SHA for every tree the PR touches. Zero checks is green only for
  docs-only; otherwise dispatch the missing workflow. Skipped is not green.
- The jev-route review depth for the diff passed (`node ~/.agents/skills/jev-route/scripts/route.mjs
  review`), cross-vendor for protected paths (global list plus [.jev-route.json](.jev-route.json)).
  Every finding is fixed or refuted in the PR.
- No unresolved review threads (GraphQL `reviewThreads.isResolved`), no `CHANGES_REQUESTED`.
- Recorded merge order holds: "Stacked on #N" / "Merge after #N" waits for N; stacked PRs merge
  base-first, then `gh pr edit --base main`.
- After each merged batch: combined regression review on `main` (`route.mjs review --git
  <pre>...main`), fixed forward. Never deploy an unreviewed batch.

**2. Deploy and publish.** Control plane: in the maintainer's `main` checkout bound to the `tono`
wrangler profile, `git pull --ff-only`, export D1 if a migration is pending (ops plan §2 item 7),
then `npm run deploy` in `services/control-plane`; it refuses anything but clean pushed `main` and
applies migrations before both Workers (migrations only through it). Ad-hoc remote D1 writes only
when the task names them, after an export. `wrangler secret put` only with an owner-supplied value;
never invent, print or commit one. Rollback: `npx wrangler rollback` per Worker; not migrations.

Customer channel publish only after the owner has written `[x]` for G1, G2 and G3 in SHIP_PLAN §6
with evidence links; agents never edit those lines. Then G4 is the agent's:
- macOS: tag `tono-macos-<v>-build<n>` on pushed `release/macos` → `.github/workflows/macos-release.yml`
  → `gh release create` → `tooling/scripts/upload-release-asset.mjs` → `tooling/scripts/publish-macos-appcast.mjs`
  (no `--dry-run`) → commit `services/control-plane/public/appcast.xml` on `main` → deploy. Not yet run
  end to end; the proven path is `tooling/scripts/release-macos.sh --publish` on a Mac with the signing
  identity. Rollback: ship the last good source as a higher build.
- Windows: `.github/workflows/windows-release.yml` on `release/windows` (approve the environment
  with your own token) → publish the draft → `tooling/scripts/upload-release-asset.mjs` →
  `.github/workflows/windows-update-promote.yml` (advances `windows-updates` and
  `services/control-plane/public/windows/latest.json`) → deploy. Rollback: promote a higher version.

**3. Product decisions that used to wait for the owner:** choose the stricter, non-leaking option
(append over replace, default off, keep hy2 stripped, never remove a node or disable a user unless
the task says so), record it in [docs/DECISIONS.md](docs/DECISIONS.md) as provisional, and continue.

## Verification

Smallest check for the touched tree, on the right host ([docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md)):
`apps/macos` the XCTest for the changed behavior; `apps/windows` `cargo test` in the edited workspace;
`services/control-plane` `npm test` or the matching test file; `services/ops-console` vitest for the
file, Playwright only for a changed page flow; docs only none. The MacBook edits and reviews; it
does not run `xcodebuild`, `swift build/test`, native `cargo`, Tauri, Core builds or packaging
(owner, 2026-09-14); hosted CI does. A check that cannot run remotely is reported as not run.
One narrow regression per behavior: one `#[test]`, one XCTest, one `it`; no table-driven suites.

## Records and Git

Every delivery updates [docs/INTERNAL_CHANGELOG.md](docs/INTERNAL_CHANGELOG.md) in the same PR (its
template; deploys and publishes with source SHA and artifact hashes). Read [docs/FINDINGS_LEDGER.md](docs/FINDINGS_LEDGER.md)
before a review or bug fix so known, fixed or refuted findings are not re-reported; update its rows
in the delivering PR. Delete superseded docs. Lines: `release/macos`, `release/windows`, `main` (the
only production Worker source; merge commits, no history rewrite): [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md).
