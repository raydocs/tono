# Merge sweep status: 21:10 MT, Sep 30

- **Merged since 18:30 MT:** 182 PRs (first-parent merges on main). Main is at `8e2baa8a`.
- **Open PRs:** 64 (base main plus the ops-console stack). 46 have auto-merge on and are waiting on CI.
- **Main CI:** the latest full snapshot (`ci-gate` on a copy of main, `e504f6f4`, run 36805897820) passed every job, including `macos / build` (finished 21:07). The earlier snapshot on `184111a2` failed only on the control-plane ratchet (#918, fixed by #931). No push run on main has failed.
- **Is main green enough to build:** yes. Windows, services, sing-box, connect-bench and the macOS policy/privileged tests are all green on `e504f6f4`; `macos / build` passed too.

## Breakages since 18:30, all fixed forward
- Control-plane unchecked-index ratchet, 522 vs 521: caused by #918 (`c303c534`), fixed by #931 (`7264d036`). I re-ran 12 PRs by merging main into them.
- `records.test.mjs` hard-coded the newest decision (038), so any new `docs/decisions/039-*` failed. Fixed by #975 (merged).
- Ops-console ratchet, 224 vs 219: caused by #869 (`e8cb7ade`), fixed by #981 (merged, `d8c6a15a`). Re-ran #716, #975, #976, #969, #904, #871, #870, #825.

## Still failing CI (real failures in the PR's own code; each has a comment)
- #966 `macos / build`: LocalizationCoverageTests. 4 new "Secure app routing…" strings have no zh-Hans translation.
- #886 `macos / build`: ProtectedSystemResolverTests, the system-DNS deadline test timed out (1s). It's in the PR's own area.
- #964 `macos / policy-tests`: the peer-auth signing probe exits 1 after re-signing `auth-client`. The PR changes that script.
- #746, #747, #748 (ops-console stack): `services / ops-contract` fails because they predate the ratchet, and #746 conflicts with main in `services/ops-console/src/pages/Nodes.tsx`. Main's Nodes page has hero counts, lifecycle chips, a cards/table switch and the `oldestFetch` R2 fix, while #746 rewrites the page. **They need a rebase by an agent, since the d728 owner is gone.** Details are in my comment on #746.
- Now merged after fixes: #866, #870, #871, #904, #969, #749, #825, #716.

## Ops-console stack
- #743: I fixed its 36 ratchet errors in the chart components (`5f9b6cf0`). Auto-merge is on and it's waiting for CI.
- #745: I merged the fixed #743 into it and fixed 3 errors in `slo.ts`. Its CI is green, and it gets retargeted to main and auto-merged once #743 merges.
- #746 → #747 → #748: blocked, see above.

## Former UI PRs (ui-review removed at 19:40)
- Merged: #805, #734, #848, #869, #880, #716 and others.
- Old PRs refreshed onto main for a fresh `ci-gate` run: #713, #717, #719, #721, #723, #726, #731, #737, #744. All pass the four ratchets locally.
- #739: fixed 3 Windows-app ratchet errors.
- #735: resolved a fixtures conflict and fixed its test mock for main's #932 account scope.

## Conflicts commented, waiting on owners
#352, #781, #930, #926, #852, #958 (`SingBoxConfigTests.swift`), #979 (`ProtectedDNSManager.swift`, helper), #982 (`dns/tests.rs`).

Not touched: #724, #725 (telemetry, waiting on the user), #691, #694, #663, #887, #203, #204.
