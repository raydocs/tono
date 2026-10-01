## 2026-10-01 · Preserve Access availability errors across response-body reads
- Scope: ops plan; authenticated console availability.
- Source: origin/main `8e276a78`; branch `hunt/sol-r4cpc-access-body-unavailable`, PR [#1190](https://github.com/raydocs/tono/pull/1190).
- Fix: an interrupted Access signing-key response now returns `503 ACCESS_UNAVAILABLE`. Previously it escaped the availability handler and returned `401 ACCESS_UNAUTHORIZED`, causing an expired-login message for a valid session.
- Added behavior: none; all token signature, claims, audience, and administrator checks remain required.
- Regression: one Worker/D1 test failed with expected 503 / actual 401, then passed and verified the same assertion succeeds after provider recovery.
- Verification: Linux, Node 22.14.0; `npm run typecheck` passed; `npx vitest run test/worker.test.ts` passed 204 tests.
- Release: source only; no package, deployment, or publication.
- Limits: this repairs error classification; no cookie revocation or customer network failure was demonstrated.
