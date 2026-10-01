# R4-WinTS: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:54 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1118 | hunt/sol-r4ts-traffic-feed-recovery | bug | yes | fix(windows): preserve controller feeds when the tray loads |
| 1123 | hunt/sol-r4ts-feed-error-live | bug | yes | fix(windows): retire stale live feed flags after controller errors |
| 1129 | hunt/sol-r4ts-metadata-owned-keys | bug | yes | fix(windows): reject inherited node and process metadata keys |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4TS-TRAY-CLEARS-FEEDS | Windows TypeScript | P2 | apps/windows/app/src/main.tsx:163 | First tray WebView load clears all native controller sockets, leaving dashboard/Activity stale handles | real-fixed #1118 (merged; CI green) |
| R4TS-FEED-ERROR-LIVE | Windows TypeScript | P2 | apps/windows/app/src/hooks/use-traffic-data.ts:65 | Traffic/Activity transport errors retain live=true and suppress freshness recovery | real-fixed #1123 (merged; CI green) |
| R4TS-ACCOUNT-LIVE-FAILURE-LEFTOVER | Windows native account (followed from TS) | P2 | apps/windows/app/src-tauri/src/tono/commands/account.rs:359 | Replacement account inherits live connect error/steps despite retained-history reset | real-unfixed outside slot; issue #1125 |
| R4TS-NODE-META-PROTOTYPE | Windows TypeScript | P2 | apps/windows/app/src/pages/tono/node-meta.ts:80 | Valid prototype-key catalog names resolve inherited metadata and crash rendering | real-fixed #1129 (merged; CI green) |
| WIN-ACTIVITY-PROCESS-PROTOTYPE | Windows TypeScript | P3 | apps/windows/app/src/pages/tono/activity.tsx:76 | Extensionless toString process still crashes the translation lookup after merged #951 | real-fixed #1129; continuation of #951 (merged; CI green) |
| R4TS-UI-H01 | Windows TS | P1 | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:54 | Replacement sign-in displays old cached devices | duplicate of #932; current queries scoped by auth generation |
| R4TS-UI-H02 | Windows TS | P2 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:52 | AI tally crosses account scopes | duplicate of #1085; claimed by other |
| R4TS-UI-H03 | Windows TS | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:69 | Revoke dialog survives account replacement | false-positive: auth guard unmounts Account during replacement |
| R4TS-UI-H04 | Windows TS | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:78 | Pending revoke affects replacement account | false-positive: native identity fences and server device ownership |
| R4TS-UI-H05 | Windows TS | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:90 | Pending sign-out wipes replacement credentials | false-positive: account-close lifetime excludes login and logout fences identity |
| R4TS-UI-H06 | Windows TS | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:100 | Old sign-out completion destroys replacement session | false-positive: only old scoped caches cleared; ready guard corrects navigation |
| R4TS-UI-H07 | Windows TS | — | apps/windows/app/src/tono-ui/SupportReportAction.tsx:31 | Late preview or receipt crosses account ownership | false-positive: keyed child and native preview/upload identity fences |
| R4TS-UI-H08 | Windows TS | — | apps/windows/app/src/tono-ui/useReleaseProtection.tsx:31 | Changed protection invalidates release consent | false-positive: explicit Restore deliberately releases current session |
| R4TS-UI-H09 | Windows TS | — | apps/windows/app/src/tono-ui/useReleaseProtection.tsx:28 | Reopened confirmation duplicates release | false-positive: useLockFn and native release coordinator serialize |
| R4TS-UI-H10 | Windows TS | — | apps/windows/app/src/providers/window/window-provider.tsx:44 | Delayed resize registration leaks listener | false-positive: late unlisten awaited; callbacks guard unmount |
| R4TS-UI-H11 | Windows TS | — | apps/windows/app/src/pages/_layout/hooks/use-loading-overlay.ts:13 | StrictMode cleanup leaves blocking overlay | false-positive: data-hidden disables pointer events and opacity |
| R4TS-UI-H12 | Windows TS | — | apps/windows/app/src/tono-ui/ServicePrereqBanner.tsx:72 | Hung prerequisite query freezes lifecycle or machine | false-positive: blocking worker holds no lifecycle lock; only banner waits |
| R4TS-UI-H13 | Windows TS | — | apps/windows/app/src/tono-ui/tono-layout.tsx:166 | Shortcut rejection crashes the application | false-positive: global rejection logger and native lifecycle reconciliation |
| R4TS-H-H03 | Windows TS | P3 | apps/windows/app/src/services/tono.ts:874 | Shared status listener leaks on another subscriber | duplicate of #820; live-listener guard present |
| R4TS-H-H04 | Windows TS | P2 | apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:170 | onConnected watchdog invalidates recovery | duplicate of #768; watchdog ends before optional initializer |
| R4TS-H-H05 | Windows plugin caller | P2 | apps/windows/crates/tono-plugin-core/guest-js/index.ts:448 | Numeric WebSocket handle cannot deserialize | duplicate of #834; current JS/native handle contract fixed |
| R4TS-H-H06 | Windows TS | — | apps/windows/app/src/hooks/use-tono.ts:54 | Initial status listener gap leaves status stale | false-positive: subscription reread plus visible five-second poll |
| R4TS-H-H07 | Windows TS | — | apps/windows/app/src/services/tono.ts:881 | Late registration leaks after teardown | false-positive: zero-subscriber completion unlistens |
| R4TS-H-H08 | Windows TS | — | apps/windows/app/src/services/query-client.ts:96 | Old status fetch overwrites a pushed mutation | false-positive: SWR mutation supersedes earlier request |
| R4TS-H-H09 | Windows TS | — | apps/windows/app/src/services/server-selection.ts:20 | Selection acknowledgement races Connect admission | false-positive: recognized competing admission errors handled |
| R4TS-H-H10 | Windows TS | — | apps/windows/app/src/services/preload.ts:111 | Preload hangs startup forever | false-positive: actual entry has two-second bootstrap fallback |
| R4TS-H-H11 | Windows TS | — | apps/windows/app/src/hooks/use-tono-preferences.ts:12 | Preferences remain stale after remount | false-positive: root subscribers remain mounted and events revalidate |
| R4TS-H-H12 | Windows TS | — | apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:167 | Late socket adopts wrong controller generation | false-positive: attempt epoch and controller generation fences |
| R4TS-H-H13 | Windows TS | — | apps/windows/app/src/hooks/use-connection-data.ts:285 | Old close clears a replacement socket | false-positive: detach before await and captured socket handle |
| R4TS-H-H14 | Windows plugin caller | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:421 | Close handshake freezes user network | false-positive: telemetry-only path; no network effect proved |
| R4TS-H-H15 | Windows plugin caller | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:51 | Graceful Close/EOF stalls live-core telemetry | false-positive: no verified same-generation trigger; core replacement restarts feeds |
| R4TS-P-H04 | Windows TS | — | apps/windows/app/src/pages/tono/servers.tsx:118 | Unscoped server cache leaks private account identity | false-positive: immediate local snapshot read and current native selection validation; transient public node labels only |
| R4TS-P-H05 | Windows TS | — | apps/windows/app/src/pages/tono/servers.tsx:221 | Overlapping hot switches conflict | false-positive: native tasks.switch admission guard |
| R4TS-P-H06 | Windows TS | — | apps/windows/app/src/pages/tono/servers.tsx:186 | Stale recommendation or favorite mutates new account | false-positive: native generation/scope/revision fences |
| R4TS-P-H07 | Windows TS | — | apps/windows/app/src/pages/tono/servers.tsx:312 | Cancelled server tests publish to replacement account | false-positive: cancellation and native auth-generation fences |
| R4TS-P-H08 | Windows TS | — | apps/windows/app/src/pages/tono/activity.tsx:233 | Old Activity close affects replacement controller | false-positive: native close requires controllerGeneration |
| R4TS-P-H09 | Windows TS | — | apps/windows/app/src/pages/tono/login.tsx:179 | Concurrent Send/Verify corrupts login | false-positive: shared authRequestPendingRef admission |
| R4TS-P-H10 | Windows TS | — | apps/windows/app/src/pages/_layout/tono-auth-guard.tsx:54 | Authenticating status unmounts sign-in form | false-positive: guard preserves form during Authenticating |
| R4TS-P-H11 | Windows TS | — | apps/windows/app/src/pages/tono/intro.tsx:24 | Denied storage permanently blocks intro completion | false-positive: in-memory completion fallback |
| R4TS-P-H12 | Windows TS | — | apps/windows/app/src/pages/tono/health-check.tsx:45 | Old health snapshot claims current live evidence | false-positive: collectedAt and current-evidence checks explicitly identify snapshot |
| R4TS-P-H13 | Windows TS | — | apps/windows/app/src/tono-ui/useReleaseProtection.tsx:31 | Release dialog applies stale connection ownership | false-positive: explicit release intentionally targets current session |
| R4TS-P-H14 | Windows native account | — | apps/windows/app/src-tauri/src/tono/commands/diagnostics.rs:193 | Previous failure exposes another account credentials | false-positive: structural scrubbers; stale attribution separately verified #1125 |
| R4TS-R-H01 | Windows TS | — | apps/windows/app/src/utils/search-matcher.ts:36 | Regular expression input freezes active Activity search | false-positive: helper has no active production caller; Activity uses plain string filters |
| R4TS-R-H02 | Windows TS | — | apps/windows/app/src/hooks/use-traffic-data.ts:22 | Global duplicate suppression breaks second consumer | false-positive: dashboard and tray consumers run in separate WebViews |
| R4TS-R-H03 | Windows TS | — | apps/windows/app/src/hooks/use-update.ts:77 | Disabling automatic checks disables manual update check | false-positive: query key remains enabled and manual refetch executes |
| R4TS-TRAY-STALE-RATE | Windows TypeScript | P3 | apps/windows/app/src/tono-ui/TrayPanel.tsx:95 | Tray ignores feed live=false and indefinitely presents cached traffic rates as current | real-unfixed visual change excluded; issue #1137 |
