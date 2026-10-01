## 2026-10-01 · Retain recovery history before account counters appear
- Ownership: SHIP_PLAN §2 item 10; exit-agent cumulative billing correctness.
- Source: baseline `6082fdee`; branch `hunt/sol-r4fcp-empty-counter-carry`; fixes #1199. Source only.
- Defect fix: missing-ledger recovery skipped a server watermark when a complete counter snapshot had no labels, forgiving later new usage. Keep the watermark in existing accounting totals so later labels add their full new reading.
- Added/optimized: no protocol or state-schema change; accounting carry remains independent of client authorization.
- Engineering/tests: one real two-round run_once regression uses actual roster parsing, reconciliation, counter parsing and stable marker logic with external I/O mocked. It fails before the fix and verifies1050 then1130 after new-device80, without synthetic credential installation.
- Verification: Linux full matching pytest file116 passed plus7 subtests; py_compile and diff checks passed. Independent read-only review checked legacy/new generation/restart/idle paths.
- Candidate/publication: no deploy, publication or new candidate.
- Remaining limits: live Xray/systemd acceptance not run; unobservable generation and legacy handoff decisions #4/#5 remain unchanged.
