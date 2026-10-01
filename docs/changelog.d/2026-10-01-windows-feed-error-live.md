## 2026-10-01 · Windows controller errors retire live feed evidence
- Ownership: SHIP_PLAN §2 item 10; Windows lifecycle reliability.
- Source: baseline `718eda43`; branch `hunt/sol-r4ts-feed-error-live`; PR pending, not merged at authoring.
- Defect fix: traffic/Activity transport errors previously kept old samples marked live, suppressing existing missing-feed recovery; clear the flags and discard queued Activity frames until a new frame arrives. Finding R4TS-FEED-ERROR-LIVE (P2).
- Added/optimized: none; no visual layout, Core or protection policy change.
- Engineering/tests: one narrow regression per hook, including a pending Activity throttle frame; both failed before with live=true after a terminal error.
- Verification: Linux Node 24 / pnpm 11.26.0, focused two files: 5 tests passed after the fix; `pnpm typecheck` passed (unchecked-index errors 79/baseline 79). Native Windows/Tauri transport checks not runnable here.
- Candidate/publication: source only; no new candidate or publication.
- Limits: telemetry freshness does not prove tunnel health. Graceful native Close/EOF behavior is outside this change.
