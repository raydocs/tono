## 2026-10-01 · Windows tray hides cached traffic rates when the feed is unavailable
- Ownership: ops plan (docs/ops/plan-2026-09-11.md), Windows tray display; not a ship gate.
- Source: branch `claude/fix-1137-tray-stale-rate`; fixes #1137 (R4TS-TRAY-STALE-RATE).
- Defect fix: after #1123 marks the controller traffic feed unavailable, the tray still showed the retained sample as current `↑/↓ …/s`. `TrayPanel` now reads `live` from `useTrafficData` and renders the rate spans only while live, as `dashboard.tsx` does. The tray has no session totals; nothing is zeroed or discarded, and tunnel status is unchanged.
- Engineering/tests: one `TrayPanel` regression (live=true shows the cached rates, live=false with the same cached sample hides them); it failed on the old code.
- Verification: `vitest run src/tono-ui/TrayPanel.test.tsx` in apps/windows/app, 8 tests passed; `tsc --noEmit` clean for TrayPanel; biome format clean. Presentation (rates hidden, no placeholder) is the minimal choice pending UI review.
- Candidate/publication: source only, no new candidate, deploy or publication.
