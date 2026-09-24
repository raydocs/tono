# Tono — agent notes

Cloud-managed VPN: clients pull a per-device exit catalog and a signed traffic policy, then dial VLESS
Reality nodes. Maps: [docs/README.md](docs/README.md), [docs/architecture.md](docs/architecture.md) (deployables, code map, do-not list).
[docs/SHIP_PLAN.md](docs/SHIP_PLAN.md) owns customer 0.0.73 (gates G1–G4);
[docs/ops/plan-2026-09-11.md](docs/ops/plan-2026-09-11.md) owns ops work (not a ship gate). Every PR
names one ship gate or one ops task; during the G4 freeze only the fixes SHIP_PLAN §2 item 10 allows.

## Invariants (never loosen)

- Fail-closed at PF / WFP. No `skip-cert-verify`. No unprivileged sidecar path.
- The managed catalog holds Tono-issued exits only; ` · hy2` is a second block on the same node,
  not a second identity (`services/control-plane/src/catalog-yaml.ts`).
- Leftover Clash Verge names in the privileged path (`StartClash`, the upgrade process sweep) change
  only in a dedicated cleanup, never inside a product fix.

## Finish the work (owner decisions, 2026-09-24)

These conditions are the approval: when they hold, act; do not stop to ask.

**1. Merge** with `gh pr merge N --merge` when all hold:
- CI is green on the exact head SHA for every tree the PR touches. Zero checks is green only for docs-only;
  otherwise dispatch the missing workflow. Skipped is not green.
- The jev-route review depth for the diff passed: from an up-to-date `origin/main` checkout run
  `node ~/.agents/skills/jev-route/scripts/route.mjs review --git origin/<baseRefName>...<headRefOid>`,
  run every slot it names (cross-vendor for protected paths: global list plus [.jev-route.json](.jev-route.json)),
  fix or refute every finding in the PR, and post the decision id, slots run and verification as a PR comment.
- No unresolved review threads (GraphQL `reviewThreads.isResolved`), no `CHANGES_REQUESTED`.
- The merge order in the PR body ("Stacked on #N", "Merge after #N" or a `## Merge order` section)
  holds: wait for N; stacked PRs merge base-first, then `gh pr edit --base main`.
- A combined regression review on `main` follows each merged batch: every commit on `main`, merged or
  direct (feed commits count), after the last reviewed SHA, which is the end of the last range recorded
  in the changelog or else the `buildSha` from `https://api.afk.ccwu.cc/api/v1/system/version`. Run
  `route.mjs review --git <that-sha>...origin/main`, fix forward, record the range. Never deploy an unreviewed batch.

**2. Deploy and publish.** Control plane: in the maintainer's `main` checkout bound to the `tono`
wrangler profile, `git pull --ff-only`, export D1 if a migration is pending (ops plan §2 item 7),
then `npm run deploy` in `services/control-plane`; it refuses anything but clean pushed `main` and
applies migrations before both Workers (migrations only through it). Remote D1 reads are free; ad-hoc
remote writes only when the task names them, after an export; a restore only as an explicit restore
task ([docs/ops/restore-production.md](docs/ops/restore-production.md)). `wrangler secret put` only with an owner-supplied value;
never invent, print or commit one. Rollback: `npx wrangler rollback` per Worker; not migrations.

Customer channel publish only after the owner has written `[x]` for G1, G2 and G3 in SHIP_PLAN §6
with evidence links; agents never edit those lines. Then G4 is the agent's: steps, the two Windows
environment approvals and rollback are in [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md#customer-publish-g4). The proven macOS
path (`tooling/scripts/release-macos.sh --publish`) runs on the Mac Studio, never the MacBook; its sudo step is the owner's.

**3. Product decisions that used to wait for the owner:** choose the stricter, non-leaking option
(append over replace, default off, keep hy2 stripped, never remove a node or disable a user unless
the task says so; a credential suspected compromised is disabled at once), record it in
[docs/DECISIONS.md](docs/DECISIONS.md) as provisional, and continue.

## Verification

Smallest check for the touched tree, on the right host ([docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md)):
`apps/macos` the XCTest for the changed behavior (full suite only if the helper or connect FSM moved);
`apps/windows` `cargo test` in the edited workspace; `services/control-plane` `npm test` or the matching
test file; `services/ops-console` vitest for the file, Playwright only for a changed page flow; docs only
none. The MacBook edits and reviews; it does not run `xcodebuild`, `swift build/test`, native `cargo`,
Tauri, Core builds or packaging (owner, 2026-09-14); hosted CI does. A check that cannot run remotely is
reported as not run. One narrow regression per behavior: one `#[test]`, one XCTest, one `it`; no tables.

## Records and Git

Every delivery updates [docs/INTERNAL_CHANGELOG.md](docs/INTERNAL_CHANGELOG.md) in the same PR (its template); the merging
agent checks it (read-only and formatting-only PRs excepted). Record each deploy, publish, environment
self-approval and reviewed range there too. Read [docs/FINDINGS_LEDGER.md](docs/FINDINGS_LEDGER.md) before a review or bug fix;
update its rows in the delivering PR. Delete superseded docs. Lines: `release/macos`, `release/windows`, `main` (the
only production Worker source; merge commits, no history rewrite): [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md).
