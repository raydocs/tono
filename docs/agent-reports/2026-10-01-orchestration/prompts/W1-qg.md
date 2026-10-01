## YOUR ROLE (slot W1-qg: industrial-grade quality gates; branch prefix `qg/`)
You do NOT hunt product bugs. You harden CI and the test infrastructure in SMALL PRs, each with auto-merge (merge commit) enabled.
- Keep total CI wall time roughly flat: prefer path-filtered jobs and caching. Never lower an existing gate, never skip or delete tests, and never make a failing check advisory to get green.
- The only required check is `ci-gate`: `.github/workflows/ci-gate.yml` plus `tooling/scripts/ci-gate-changes.mjs` and its tests. A merge queue is live, and another executor owns rulesets and merges. Do NOT edit rulesets or branch protection. Do NOT update-branch other PRs.

Work items, in priority order. Each is its own PR.
1. **Split `docs/DECISIONS.md` into one file per decision** under `docs/decisions/` (keep numbering and anchors; replace DECISIONS.md with an index, generated or hand-written, plus a note on how to add one). It is the #1 merge-conflict hotspot.
   - Update AGENTS.md, docs/README.md and any scripts or links that reference DECISIONS.md, including `tooling/scripts/records.mjs` if relevant.
   - Do it as ONE PR, fast, with auto-merge. Before pushing, rebase onto the latest main so no decision added in the meantime is lost, and verify that the decision count matches.
2. **Flaky-test detection and fixing.**
   - Scan the last ~200 workflow runs (`gh run list -R raydocs/tono --limit 200 --json ...`, `gh run view --log-failed`) for tests that failed and then passed on rerun on the same SHA, and for cancelled jobs.
   - Fix the root cause of each flake (timeouts, loopback DNS, port collisions, time-dependent tests, ordering). Record the list in the PR body.
   - The connect_bench loopback DNS flake is already fixed in #749.
3. **Strict type/lint settings where cheap.** TS `strict`/`noUncheckedIndexedAccess` per package if already close; `cargo clippy -D warnings` on crates that are already clean; SwiftLint only if already configured. Fix the violations in the same PR only if they are few and mechanical, otherwise ratchet (fail only on new violations).
4. **Coverage reporting with a floor on critical modules**: c8/vitest coverage for control-plane auth/sessions/quota/ledger, and `cargo llvm-cov` or tarpaulin for tono-core auth/policy/config and the service kill switch (only if it runs on Linux CI). Set the floor at the current value minus a small margin (a ratchet), reported in the job summary. Keep it path-filtered.
5. **Property/fuzz tests for parsers**:
   - subscription/protocol URL parsing (vless/hy2/trojan/ss links) in tono-core (proptest) and in the macOS `SubscriptionURLPolicy`/`ConfigParser` (XCTest with generated inputs);
   - catalog-yaml and traffic-policy parsing in control-plane (fast-check);
   - helper IPC message decoding (Swift) and Windows service IPC decoding (Rust).
   Run a bounded number of cases in CI (seconds, not minutes). Real bugs you find: fix them in separate small PRs (label `needs-hardware` if network behavior changes).
6. **Concurrency tests for known race hotspots**: control-plane D1 ON CONFLICT/upsert paths (revocation reopen, cluster open, session refresh vs logout), and Windows app connection lifecycle (switch vs disconnect vs quit) where unit-testable.
7. **Dependency audit, advisory only** (never blocking): `npm audit --omit=dev` per package, `cargo audit`/`cargo deny advisories`, Swift package pins. Weekly schedule plus path-filtered on lockfile changes; results go in the job summary.

Rules: the same PR hygiene as the hunters (changelog.d entry, non-draft, auto-merge with a merge commit, no DECISIONS.md edits other than item 1).
Final report: the PRs, what each gate enforces, the CI time delta per workflow (before/after, from `gh run` timings), and the flakes found and fixed.
