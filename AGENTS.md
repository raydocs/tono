# Tono — agent notes

Cloud-managed VPN (product identity is Tono, not Clash Verge or LiquidClash): clients pull a per-device exit catalog and a signed traffic policy, then dial VLESS
Reality nodes. Maps: [docs/README.md](docs/README.md), [docs/architecture.md](docs/architecture.md) (deployables, code map, do-not list).
[docs/SHIP_PLAN.md](docs/SHIP_PLAN.md) owns customer 0.0.74 (G1–G4); [docs/ops/plan-2026-09-11.md](docs/ops/plan-2026-09-11.md) owns ops work (not a
ship gate). Every PR names one of them; during the G4 freeze only SHIP_PLAN §2 item 10 fixes merge.

## Invariants (never loosen)

- Fail-closed at PF / WFP. No `skip-cert-verify`. No unprivileged sidecar path.
- The managed catalog holds Tono-issued exits only; ` · hy2` is a second block on the same node,
  not a second identity (`services/control-plane/src/catalog-yaml.ts`).
- Leftover Clash Verge names in the privileged path (`StartClash`, the upgrade process sweep) change
  only in a dedicated cleanup, never inside a product fix.

## Finish the work (owner decisions)

These conditions are the approval: when they hold, act; do not stop to ask.

**1. Merge** through the merge queue. Auto-merge is on for `main`. The only required status check is `ci-gate`. Merges use merge commits. Enable auto-merge with `gh pr merge --auto --merge` on a ready, non-draft PR when the conditions below hold. Do not enable it on a UI PR or a PR that needs real-hardware testing. On a conflict or a helper-version collision, rebase onto current `main` and set `HelperProtocolVersion.current` (`apps/macos/Tono/Core/HelperProtocolVersion.swift`) to main's value plus `0.0.1`.
- `ci-gate` is green on the exact head SHA. It calls the path-filtered workflows and passes when each relevant job succeeded or was skipped because its paths were not touched. A missing `ci-gate` run is not green; dispatch `ci-gate`. Do not also dispatch those workflows on the pull request (they would run a second time). Docs-only and uncovered paths: [docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md#which-workflow-must-be-green-for-a-pr).
- Ordinary work (copy, docs, UI, a normal bug or feature outside the risks below): the main session checks the
  diff and runs the narrowest relevant test. No mandatory Jev call, planning agent, external review or second
  model checking a report. Jev is optional, not a per-PR approval gate.
- High-risk changes (money, credentials/permissions, PF/WFP fail-closed behavior, privileged paths, concurrency/
  lifecycle, migrations, routing or release trust), or an owner-requested review: an independent Codex high review
  of the current diff must finish before merge/deploy. Run it in the background with named invariants and a
  coverage checklist; it never blocks implementation, tests or a draft PR. Record the covered SHA, scope,
  findings and verification in a PR comment. Pending, timed-out, incomplete or stale coverage is not a pass.
  If Jev is explicitly chosen, use trusted main's policy, not the PR's; preserve its applicable risk floors.
  Stop rule: only major or worse blocks. Minors get one fix round; any still open after it are recorded
  open in `docs/findings.d/` (product defects) or in the PR body's limitations (engineering/test/docs items the ledger excludes),
  then merge. At least major: loosening fail-closed PF/WFP, a leak, privilege escalation, cross-account mixing, or showing
  protected when protection is released (the ledger's 高 impact).
- No unresolved review threads (GraphQL `reviewThreads.isResolved`), no `CHANGES_REQUESTED`.
- The merge order in the PR body ("Stacked on #N", "Merge after #N" or a `## Merge order` section)
  holds: wait for N; stacked PRs merge base-first, then `gh pr edit --base main`.
- Before deploying a merged batch, check the integration delta and relevant regression tests. Reuse recorded
  review coverage of exact PR heads; do not re-review the whole batch by default. Review only new high-risk
  merge-resolution/integration changes and uncovered high-risk commits (direct commits count), recording the
  range and reused coverage. Do not deploy uncovered high-risk changes; this does not relax any release gate.

**2. Deploy and publish.** Control plane: in the maintainer's `main` checkout bound to the `tono` wrangler
profile, `git pull --ff-only`, export D1 before every production deploy (ops plan §2 item 7), then
`npm run deploy` in `services/control-plane` (clean pushed `main` only; applies migrations, then both Workers).
Rehearse migrations on preview first (§2 item 1); production migrations only through the script. Remote
D1 reads are free; ad-hoc writes only when the task names them, after an export; restores only as an
explicit task ([docs/ops/restore-production.md](docs/ops/restore-production.md)). `wrangler secret put` takes an owner-supplied value, or a CSPRNG
value for a Tono-controlled secret the task names for creation or rotation (coordinate its consumers first);
never fabricate third-party credentials or print or commit a secret. Rollback: `npx wrangler rollback` per Worker.

Customer channel publish only after the owner has written `[x]` for G1, G2 and G3 in SHIP_PLAN §6
(for 0.0.74 only: G1 and G2; G3 moves to 0.0.75 by owner decision, [DECISIONS](docs/decisions/019-2026-09-26-release-0074-defers-g3.md)) with evidence links; agents never edit those lines. The evidence names the candidate (source SHA, package
hashes); publish only that candidate. Any other SHA or version needs new owner evidence, except rebuilding
a published good source as a higher build for rollback. Then G4 is the agent's, in SHIP_PLAN §5 order
(G4.2 on the owner's devices first; G4.3 needs the release row's `verifiedAt`); steps, both Windows
environment approvals, the Mac Studio-only proven macOS path and rollback: [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md#customer-publish-g4).

**3. Product decisions with no owner answer:** choose the stricter, non-leaking option (append
over replace, default off, keep hy2 stripped, never remove a node or disable a user unless the task says so;
a credential suspected compromised is disabled at once), record it as a new file under [docs/decisions/](docs/decisions/README.md) with status `provisional`, and continue. Read them with `node tooling/scripts/records.mjs decisions`. Do not append to [docs/DECISIONS.md](docs/DECISIONS.md); that file is the index.

## Verification

Smallest check for the touched tree, on the right host ([docs/BUILD_AND_TEST.md](docs/BUILD_AND_TEST.md)): `apps/macos` the XCTest
for the changed behavior (full suite only if the helper or connect FSM moved); `apps/windows` `cargo test` in the
edited workspace; `services/control-plane` `npm test` or the matching test file; `services/ops-console` vitest for
the file, Playwright only for a changed page flow; docs only none. The MacBook edits and reviews; it does not
run `xcodebuild`, `swift build/test`, native `cargo`, Tauri, Core builds or packaging; hosted
CI does. Do not install toolchains, sync build caches, remove active worktrees or delete retained evidence to
make a default local command work. Unrunnable checks are reported as not run. One narrow regression per behavior: one `#[test]`, one XCTest,
one `it`; no tables.

## Records and Git

Every delivery adds one `docs/changelog.d/YYYY-MM-DD-<slug>.md` in the same PR ([template](docs/changelog.d/README.md); continuations edit
that file; [docs/INTERNAL_CHANGELOG.md](docs/INTERNAL_CHANGELOG.md) is frozen history; the merging agent checks, read-only and formatting-only
PRs excepted), as does each deploy, publish, self-approval and reviewed range. Read all: `node tooling/scripts/records.mjs changelog`.
Read the findings (`node tooling/scripts/records.mjs findings`: [docs/FINDINGS_LEDGER.md](docs/FINDINGS_LEDGER.md) plus `docs/findings.d/`) before a
review or bug fix; in the delivering PR add one `docs/findings.d/<ID>.md` per new finding ([format](docs/findings.d/README.md)) and update
status in that fragment, or in the ledger row if the ID has none. Delete stale docs.
Lines `release/macos`, `release/windows`, `main` (sole production Worker source; merge commits, no rewrite): [docs/RELEASE_LINES.md](docs/RELEASE_LINES.md).

## Session state

Before editing source, read and update `SESSION_STATE.md` at the repo root.
If it is missing, create it with the sections below, then edit code.

Keep SESSION_STATE.md short (target < 80 lines). Only these sections:
- Objective: done criteria
- Decided: locked decisions, do not reopen
- Active diffs: files touched this session
- Tool receipts: one line per important command — pass/fail + one-line key output
- Verification: never check off without raw terminal output pasted into the receipt
- Next: exactly one next command, or DONE

After compact, subagent start, or session resume: read SESSION_STATE.md first.
Do not reconstruct tool results from chat history.
Do not dump full logs, full diffs, or file contents into SESSION_STATE.md.

## Cursor Cloud specific instructions

Linux Cloud Agents run the checks below. `xcodebuild`, Swift, Windows service
`cargo`, Tauri, and Core packaging stay on hosted `macos-26` and `windows-2025`
CI ([BUILD_AND_TEST](docs/BUILD_AND_TEST.md)).

- Node 24 matches services and Windows frontend CI. `/exec-daemon/node` is Node 22
  and precedes nvm; a login shell prepends `~/.nvm/versions/node/v24.*/bin`.
- `npm ci` in `services/control-plane` and `services/ops-console`. Ops fixtures:
  `npm run dev:fixtures` → `http://127.0.0.1:5174/ops2/`. Playwright screenshot
  baselines are macOS; on Linux pass `--ignore-snapshots`.
- Windows UI only: `pnpm@11.26.0` (`packageManager`) and
  `pnpm install --frozen-lockfile` in `apps/windows/app`, then `pnpm web:dev`
  on port 3000. `pnpm dev` starts Tauri and does not run here. The page loads
  a Tono shell; Tauri `invoke` is absent, so it stays on the splash.
- Local D1, from `services/control-plane`: `npx wrangler d1 migrations apply DB --local`.
  Do not deploy or write production D1.
- Python 3.12 stdlib: exit-agent, home-agent, `ops-panel/tests`. Ruby 3.2:
  `ruby tooling/scripts/tests/publish-managed-catalog.test.rb`.

