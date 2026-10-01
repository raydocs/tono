Update from the orchestrator (you were launched by us).

1. STOP the rebase / update-branch / empty-commit churn. The merge queue on `main` is live, and another executor sweeps BEHIND PRs. Do not update-branch Dependabot or other PRs any more, do not re-toggle auto-merge, and do not merge main into branches that are merely BEHIND. Touch a branch only on a real conflict, and only if it is your own.

2. NEW (small) SCOPE after your current items. Low-risk leftovers; one careful pass; tiny PRs. Always start from the latest origin/main and check open PRs first.
   - **M14**: `apps/macos/Tono/Views/*`, `Models/*`, `Support/*`. ONLY crash/hang bugs: force unwraps on external data, index out of range, main-thread blocking I/O, retain cycles that keep monitors alive. No visual changes.
   - **O1**: `services/ops-console/src`. Data-correctness only (wrong totals/time zones, stale data shown as fresh). Any visible change → label `ui-review`, NO auto-merge.
   - **T4**: remaining `tooling/scripts/*` test runners and helpers (`records.mjs`, `with-slot.sh`, `build-core-helper.sh`, `test-*.sh`). Fix real bugs such as wrong exit codes that hide failures and unquoted paths.
   - **A13**: `apps/windows/crates/tono-plugin-core` (mihomo REST/WebSocket client: timeouts, reconnection, parse errors) and `tono-logger`.

3. PR rules:
   - Non-draft, merge commit, auto-merge ON except for UI PRs (`ui-review`, no auto-merge).
   - Network-behavior PRs get `needs-hardware` and still get auto-merge. Label via `gh api -X POST repos/raydocs/tono/issues/N/labels -f 'labels[]=X'`.
   - No `docs/DECISIONS.md` edits.
   - Add changelog.d + findings.d entries and regression tests.

Top rule: never cut the user's network, fail open while still blocking AI services.

Final report: a findings table with verdicts, your PRs, and your false-positive count.
