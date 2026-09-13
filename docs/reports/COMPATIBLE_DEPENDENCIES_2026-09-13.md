# Ops toolchain: compatible subset of September dependency updates

Ops scope: maintain the Worker/ops2 build and acceptance tooling under
`docs/ops/plan-2026-09-11.md`; not a new customer-ship gate.

The grouped Dependabot PRs fail at clean installation, before product tests:

- #167: Vitest 5.0.0 violates `@cloudflare/vitest-pool-workers@0.22.0`'s
  `vitest: ^4.1.0` peer dependency (Services CI run 34776598147).
- #168: TypeScript 7.0.2 violates `typescript-eslint@8.70.0`'s
  `typescript: >=4.8.4 <6.1.0` peer dependency (run 34776615770).
  That group also includes ESLint/react-hooks majors; they are not required
  for the Vite upgrade and are deliberately not bundled into this narrow fix.

This replacement updates Vite to 8.3.0 in both services and Wrangler to locked
4.131.1, with its resolved Worker types/workerd dependencies. It retains Worker
Vitest 4.1.11 and ops2 TypeScript 6.0.3 / ESLint 9.39.5 / hooks 5.2.0. No force,
legacy-peer-deps, disabled checks, application changes or CI weakening.

Verification from the final lockfiles:

- `npm ci` succeeds in both trees with peer validation enabled.
- Worker: typecheck, contract and size budgets pass; 42 test files / 885 tests pass.
- ops2: typecheck, lint, 24 files / 304 tests, build and bundle/source budgets pass.
- Native CI's existing four Playwright shards remain required before merge;
  no page flow, screenshot baseline or new test was added.

The first local lockfile generation via `npm --prefix /tmp/...` hit a path
canonicalization problem: its lock recorded `/private/tmp` locations and
`npm ci` rejected it. That output was discarded before commit; regeneration
inside the canonical worktree produced normal `node_modules/` keys, verified
by clean installs. Neither initial failure was misreported as a passing test.

No Worker deploy, remote D1, production data change, customer update-feed
promotion or kernel upgrade. Incompatible major upgrades remain deferred;
closing their grouped PRs means replaced/split, not that those majors were merged.
