## 2026-10-01 · Windows tray startup preserves controller feeds
- Ownership: SHIP_PLAN §2 item 10; Windows lifecycle reliability.
- Source: baseline `0bac2732`; branch `hunt/sol-r4ts-traffic-feed-recovery`; PR [#1118](https://github.com/raydocs/tono/pull/1118), not merged at authoring.
- Defect fix: the first tray WebView load globally cancelled the main window's telemetry sockets; remove the startup cleanup so existing dashboard and Activity feeds continue. Finding R4TS-TRAY-CLEARS-FEEDS (P2).
- Added/optimized: none; no layout or native protection change.
- Engineering/tests: one regression executes the application entry and actual packaged plugin JS with a shared registry double. Before the fix, both existing feeds were removed.
- Verification: Linux Node 24, pinned pnpm; `pnpm test src/main.test.tsx`: 1 regression passed after failing before; `pnpm typecheck`: passed, unchecked-index errors 79/baseline 79; `git diff --check`: passed. Native Windows/Tauri and installed tray acceptance not run locally.
- Candidate/publication: source only; no new candidate, deployment or publication.
- Limits: the registry double proves the cross-window cleanup call, not installed Windows WebView behavior.
