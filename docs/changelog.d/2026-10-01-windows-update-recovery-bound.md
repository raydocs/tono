## 2026-10-01 · Bound the Windows failed-update recovery relaunch loop
- Ownership: SHIP_PLAN §2 item 10; Windows failed-update recovery (`R4-WIN-UPDATE-RECOVERY-LOOP`, #1292).
- Source: baseline `4bb0ba4a`; branch `fix/win-update-recovery-bound-1292`, [#1297](https://github.com/raydocs/tono/pull/1297); not yet merged.
- Defect fix: when a failed update's rollback also kept failing, every Service start relaunched the recovery executor, which stopped the Service, failed again and restarted it, without end. Now the recovery run records its own image before stopping the Service, so the Service it restarts does not launch a second recovery. Each failed run is counted in a private `recovery-runs` sidecar in the attempt directory, but only after its network settled (released with the AI hold, or strict). After 3 counted runs, startup stops relaunching the executor and the Service starts normally. The record stays pending and update status sets `needs_attention`.
- New/optimization: none. The `state.json` schema is unchanged. In the exhausted state no binary is executed and nothing is replaced.
- Engineering/tests: one real-Store test, `update_recovery_stops_relaunching_after_bounded_failed_runs`.
- Verification: `rustfmt --edition 2024` shows no diffs on the changed lines. Windows CI runs the test. No local cargo on the MacBook.
- Candidate/publication: source only; no new candidate.
- Limits: needs-hardware (fault-injected rollback on Windows). The App only logs `needs_attention`. The manual installer still refuses a pending record, so the repair path for an exhausted record needs an owner decision.
