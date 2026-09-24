# Tono — agent notes

Cloud-managed VPN: clients pull a per-device exit catalog and a signed traffic policy, then dial VLESS
Reality nodes. Maps: [docs/README.md](docs/README.md), [docs/architecture.md](docs/architecture.md) (deployables, code map, do-not list).
[docs/SHIP_PLAN.md](docs/SHIP_PLAN.md) owns customer 0.0.73 (G1–G4); [docs/ops/plan-2026-09-11.md](docs/ops/plan-2026-09-11.md) owns ops work (not a
ship gate). Every PR names one of them; during the G4 freeze only SHIP_PLAN §2 item 10 fixes merge.

## Invariants (never loosen)

- Fail-closed at PF / WFP. No `skip-cert-verify`. No unprivileged sidecar path.
- The managed catalog holds Tono-issued exits only; ` · hy2` is a second block on the same node,
  not a second identity (`services/control-plane/src/catalog-yaml.ts`).
- Leftover Clash Verge names in the privileged path (`StartClash`, the upgrade process sweep) change
  only in a dedicated cleanup, never inside a product fix.

## Finish the work (owner decisions, 2026-09-24)

These conditions are the approval: when they hold, act; do not stop to ask.

**1. Merge** with `gh pr merge N --merge` when all hold:
- CI is green on the exact head SHA for every tree the PR touches (workflow per tree, docs-only, and uncovered
  paths needing dual_cross_family instead: [docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md#which-workflow-must-be-green-for-a-pr)). Dispatch a missing run; skipped is not green.
- The jev-route review depth for the diff passed: from an up-to-date `origin/main` checkout (routing policy is
  main's, never the PR's) run `node ~/.agents/skills/jev-route/scripts/route.mjs review --git origin/<baseRefName>...<headRefOid>`,
  run every slot it names (cross-vendor for protected paths: global list plus [.jev-route.json](.jev-route.json); a PR changing it gets
  dual_cross_family regardless), fix or refute every finding, and post decision id, slots and verification as a PR comment.
- No unresolved review threads (GraphQL `reviewThreads.isResolved`), no `CHANGES_REQUESTED`.
- The merge order in the PR body ("Stacked on #N", "Merge after #N" or a `## Merge order` section)
  holds: wait for N; stacked PRs merge base-first, then `gh pr edit --base main`.
- A combined regression review on `main` follows each merged batch: every commit on `main` (direct feed
  commits count) after the last reviewed SHA (end of the last range in the changelog, else the `buildSha` of
  `https://api.afk.ccwu.cc/api/v1/system/version`). Run `route.mjs review --git <sha>...origin/main`, fix forward,
  record the range. Never deploy an unreviewed batch.

**2. Deploy and publish.** Control plane: in the maintainer's `main` checkout bound to the `tono` wrangler
profile, `git pull --ff-only`, export D1 before every production deploy (ops plan §2 item 7), then
`npm run deploy` in `services/control-plane` (clean pushed `main` only; applies migrations, then both Workers).
Rehearse migrations on preview first (§2 item 1); production migrations only through the script. Remote
D1 reads are free; ad-hoc writes only when the task names them, after an export; restores only as an
explicit task ([docs/ops/restore-production.md](docs/ops/restore-production.md)). `wrangler secret put` takes an owner-supplied value, or a CSPRNG
value for a Tono-controlled secret the task names for creation or rotation (coordinate its consumers first);
never fabricate third-party credentials or print or commit a secret. Rollback: `npx wrangler rollback` per Worker.

Customer channel publish only after the owner has written `[x]` for G1, G2 and G3 in SHIP_PLAN §6
with evidence links; agents never edit those lines. The evidence names the candidate (source SHA, package
hashes); publish only that candidate. Any other SHA or version needs new owner evidence, except rebuilding
a published good source as a higher build for rollback. Then G4 is the agent's, in SHIP_PLAN §5 order
(G4.2 on the owner's devices first; G4.3 needs the release row's `verifiedAt`); steps, both Windows
environment approvals, the Mac Studio-only proven macOS path and rollback: [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md#customer-publish-g4).

**3. Product decisions that used to wait for the owner:** choose the stricter, non-leaking option (append
over replace, default off, keep hy2 stripped, never remove a node or disable a user unless the task says so;
a credential suspected compromised is disabled at once), record it in [docs/DECISIONS.md](docs/DECISIONS.md) as provisional, continue.

## Verification

Smallest check for the touched tree, on the right host ([docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md)): `apps/macos` the XCTest
for the changed behavior (full suite only if the helper or connect FSM moved); `apps/windows` `cargo test` in the
edited workspace; `services/control-plane` `npm test` or the matching test file; `services/ops-console` vitest for
the file, Playwright only for a changed page flow; docs only none. The MacBook edits and reviews; it does not
run `xcodebuild`, `swift build/test`, native `cargo`, Tauri, Core builds or packaging (owner, 2026-09-14); hosted
CI does. Unrunnable checks are reported as not run. One narrow regression per behavior: one `#[test]`, one XCTest,
one `it`; no tables.

## Records and Git

Every delivery updates [docs/INTERNAL_CHANGELOG.md](docs/INTERNAL_CHANGELOG.md) in the same PR (its template; the merging agent checks,
read-only and formatting-only PRs excepted), as does each deploy, publish, self-approval and reviewed range.
Read [docs/FINDINGS_LEDGER.md](docs/FINDINGS_LEDGER.md) before a review or bug fix; update its rows in the delivering PR. Delete stale docs.
Lines `release/macos`, `release/windows`, `main` (sole production Worker source; merge commits, no rewrite): [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md).
