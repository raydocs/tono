Three PRs merged through green CI. No new P0/P1 verified.

Paths below are relative to `apps/windows/app`; lines identify pre-fix triggers.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4TS-TRAY-CLEARS-FEEDS | TS bootstrap | P2 | `src/main.tsx:163` | Opening the tray clears dashboard/Activity sockets | Fixed in #1118 |
| R4TS-FEED-ERROR-LIVE | TS hooks | P2 | `src/hooks/use-traffic-data.ts:65` | Transport errors retain live status and suppress recovery | Fixed in #1123 |
| R4TS-NODE-META-PROTOTYPE | TS metadata | P2 | `src/pages/tono/node-meta.ts:80` | Prototype-key node names crash rendering | Fixed in #1129 |
| WIN-ACTIVITY-PROCESS-PROTOTYPE | TS Activity | P3 | `src/pages/tono/activity.tsx:76` | Remaining inherited process-key lookup crashes translation | Fixed in #1129; continuation of #951 |
| R4TS-ACCOUNT-LIVE-FAILURE-LEFTOVER | Native account | P2 | `src-tauri/src/tono/commands/account.rs:359` | Replacement account inherits old connection errors | Unfixed: outside TS scope; [#1125](https://github.com/raydocs/tono/issues/1125) |
| R4TS-TRAY-STALE-RATE | TS tray | P3 | `src/tono-ui/TrayPanel.tsx:95` | Unavailable feed still displays cached rates as current | Unfixed: visual change excluded; [#1137](https://github.com/raydocs/tono/issues/1137) |

[#1118](https://github.com/raydocs/tono/pull/1118), [#1123](https://github.com/raydocs/tono/pull/1123), and [#1129](https://github.com/raydocs/tono/pull/1129) all have the `bug` label and completed merge-commit auto-merge. Regression tests failed before and passed after; local typechecks and Windows CI passed. Network and AI-blocking policy were unchanged.

**46 hypotheses examined:** 35 false positives, five duplicates, four fixed behaviors and two verified unfixed findings. The [full report and false-positive log](/workspace/w1-codex/out/R4-WinTS/report.md) contains all 46 rows with reasons.

Assigned TS source coverage is complete. Native device behavior was not tested locally; the two remaining fixes are tracked above.