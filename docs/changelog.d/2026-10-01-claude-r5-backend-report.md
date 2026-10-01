## 2026-10-01 · Round-5 backend hunt (control plane, exit agent, D1 migrations)
- Scope: ops plan; covers `services/control-plane`, `services/exit-agent` and `services/home-agent`.
- Source: `origin/main` `4bb0ba4a`. Branch `claude/r5-backend`. Report: `docs/agent-reports/2026-10-01-claude-r5-backend.md`.
- Bug fixes: none. No P0, P1 or P2 was found. One P3 needs an owner decision (R5BE-EXIT-TOKEN-ROTATE-401, #1296).
- New/improved: none.
- Engineering and tests: records only. Reviewed #1232, #1246 and #1249 with no regressions. Covered device revocation through exit credentials, cross-account isolation, hy2 identity, session refresh, login rate limits, exit node tokens and log secrets.
- Verification: targeted control-plane vitest passed (15). exit-agent (118) and home-agent (26) pytest passed. All 83 migrations apply to scratch SQLite with 0 failures, and the same 8 files re-run cleanly as in round 1.
- Candidates/release: source records only; no new candidate, deploy or publish.
- Remaining limits: the full control-plane suite was not run, because no code changed.
