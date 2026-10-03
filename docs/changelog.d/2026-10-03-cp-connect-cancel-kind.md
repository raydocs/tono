# 2026-10-03 — control plane accepts the `connectCancel` telemetry kind

- Plan: [SHIP_PLAN](../SHIP_PLAN.md) G2 (field diagnosability). Owner 2026-10-03 「按你说的做」 item 7: connects that begin and never reach an outcome.
- Scope: `services/control-plane/src/ops/flatten.ts` adds `connectCancel` to `FLATTEN_KINDS`, so a user-cancelled connect (second click, Disconnect, Quit, sign-out) lands in `connection_events` with its `stage`, `elapsed_ms` and `node` instead of leaving a bare `connectBegin`. The 10-02 field snapshot showed 257 macOS `connectBegin` against 34 `connectOk` with no failure rows; the missing rows were cancels and crashes with nothing recorded.
- Not a failure: `slo-rollup.ts` and `verdict-facts.ts` count only `connectOk`/`connectFail`; a cancel changes no SLO or verdict. Nothing is removed from the filter.
- Clients: macOS and Windows emit the kind in follow-up PRs (mac `AppState+Connect.swift` cancel path; Windows `telemetry.rs INCLUDE_KINDS` + the #1356 cancel paths). Until they ship, the server accepts the kind and nothing sends it.
- Verification: `npx vitest run test/ops-flatten.test.ts` — red on main (`keeps a cancelled connect with its stage and elapsed time` fails: row count 1, cancel row absent), green after the one-line change (13 passed). Red ci-gate dispatched on the red commit; PR body records both run ids.
- No migration: `connection_events.kind` is free text (CHECK length 1–40, migration 0039).

### 2026-10-03 follow-up: merged to main
- Merged: #1365, merge commit `d684ec24`, PR head `e18b3260`. ci-gate green on that head: run 37145744818. Red run 37145662190 failed on exactly the new `it`. Not deployed: production does not accept the kind yet.
