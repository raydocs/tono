# R4-WinTS: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:15 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1118 | hunt/sol-r4ts-traffic-feed-recovery | bug | yes | fix(windows): preserve controller feeds when the tray loads |
| 1123 | hunt/sol-r4ts-feed-error-live | bug | yes | fix(windows): retire stale live feed flags after controller errors |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4TS-TRAY-CLEARS-FEEDS | Windows TypeScript | P2 | apps/windows/app/src/main.tsx:163 | First tray WebView load clears all native controller sockets, leaving dashboard/Activity stale handles | real-fixed #1118 (CI pending; auto-merge enabled) |
| R4TS-FEED-ERROR-LIVE | Windows TypeScript | P2 | apps/windows/app/src/hooks/use-traffic-data.ts:65 | Traffic/Activity transport errors retain live=true and suppress freshness recovery | real-fixed #1123 (CI pending; auto-merge enabled) |
