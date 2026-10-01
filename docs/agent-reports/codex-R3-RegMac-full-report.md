Reviewed **49 merged macOS PRs** (47 preceding fixes plus 2 own follow-ups) since 2026-09-30 23:30 UTC, through main **933e74144aeb86295f68c4e8c81b82466d8b2d88**, 2026-09-30 22:43 MDT. Initial 200-result query saturated; expanded query and closeout refresh covered every matching PR at the cutoff.

**Two verified regressions fixed and merged through CI. REG-794 remains real-unfixed: abandoned legacy-helper upgrade uses full disarm and loses AI hold. A legacy-compatible automatic-release contract is needed; suppressing release would strand normal internet. No unsafe substitute shipped.**

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| REG-717 | macOS welcome intro | - | apps/macos/Tono/Views/WelcomeIntroView.swift:29 | Single-screen intro preserves account/protection gate; both completion actions only set introSeen. | ok |
| REG-719 | macOS traffic summary | - | apps/macos/Tono/Views/DataUsageSummaryView.swift:58 | Session summary reads core totals; callers/tests updated; no network or accounting mutation. | ok |
| REG-720 | macOS recovery owner | P1 | apps/macos/Tono/Services/Connection/ConnectionCoordinator.swift:161 | Unarmed retry survives user Restore and late proof/status can reconnect and re-arm. | regression-fixed #1043 |
| REG-721 | macOS sign-in support hint | - | apps/macos/Tono/Views/AccountGateSupport.swift:158 | Removing Finder action preserves copy-details, challenge timers, resend and authentication flow. | ok |
| REG-722 | macOS connect telemetry | — | apps/macos/Tono/Models/ConnectionState.swift:34 | Shared wire keys augment diagnostic stage fields while old telemetry keys remain unchanged | ok |
| REG-738 | macOS helper | — | tooling/scripts/core-helper/SelectiveFailOpen.swift:155 | Fixed AI suffix/prefix installer uses bounded exact commands and does not mutate broad PF/default routes. | ok |
| REG-741 | macOS legacy DNS emitter | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+Runtime.swift:143 | Mihomo TTL/H3/cache settings preserve encrypted resolver routing; production sing-box changes owned by #744 | ok |
| REG-744 | macOS sing-box runtime | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:162 | Chrome fingerprint restriction, bounded fake-IP pool and sequential DoH compose with authoritative TUN verification | ok |
| REG-749 | macOS HY2 runtime | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:122 | Supported HY2 QUIC keepalive preserves certificate checks and routes; idle support text annotates diagnostics only | ok |
| REG-756 | macOS launch DNS recovery | - | apps/macos/Tono/Core/RuntimeCleanup.swift:438 | Repaired helper always restores DNS; helper sweep preserves non-loopback settings and selective AI layer. | ok |
| REG-759 | macOS helper upgrade | - | apps/macos/Tono/Core/HelperManager.swift:1199 | Never-delivered requests skip version polling; lost replies retain it. #794 release-contract concern remains separately. | ok |
| REG-760 | macOS health release | — | apps/macos/Tono/Services/AppState+Connect.swift:1607 | Helper release latch reconciles and Browser Secure DNS conflict releases promptly; automatic disarm AI gap already recorded | concern: known automatic release AI gap overlaps #1031/#1028 decision records; no new finding |
| REG-761 | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:681 | Failed placeholder cannot block release/reload stale rules; repair signal survives load errors. | ok |
| REG-762 | macOS core log stream | - | apps/macos/Tono/Core/CoreWebSocket.swift:231 | Runtime log restart cancels old buffer/receive, retains disabled state, and composes with #1027 quiet-log fix. | ok |
| REG-765 | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:147 | DNS snapshot cap matches restore/write limits; foreign authoritative reads remain uncapped. | ok |
| REG-773 | macOS helper | P1 | tooling/scripts/core-helper/SocketServer.swift:328 | Orphan bootstrap release restores internet but omits selective AI hold. | duplicate of #1028 (merged; omission fixed) |
| REG-774 | macOS proxy | — | apps/macos/Tono/Core/SystemProxy.swift:403 | Bounded proxy commands and guard coalescing retain prior cleanup paths. | ok |
| REG-778 | macOS optional policy | — | apps/macos/Tono/Services/AppState.swift:1991 | Pre-sync optional policy errors restore original session PF; replacement marker precedes sync | ok |
| REG-781 | macOS catalog | — | apps/macos/Tono/Services/AppState+Catalog.swift:229 | Home node dial identity now contributes to reload decision; nil/default handling composes with #802 | ok |
| REG-782 | macOS pin refresh | — | apps/macos/Tono/Services/AppState+Proxy.swift:563 | Unstructured bounded utun wait shields postcommit PF convergence from cancellation; disconnect drains task | ok |
| REG-788 | macOS sidecar | — | apps/macos/Tono/Services/TonoSidecarService.swift:312 | Reused unrelated PID is discarded; unreadable identity and owned-stop failure still refuse. | ok |
| REG-794 | macOS helper upgrade | P1 | apps/macos/Tono/Core/HelperManager.swift:259 | Abandoned helper upgrade automatically performs full disarm and loses AI hold | concern: automatic release shares explicit disarm disposition; requires helper intent contract and legacy compatibility |
| REG-796 | macOS session auth | — | apps/macos/Tono/Services/TonoAPIClient.swift:564 | Superseded bearer refusal reuses current renewal; credential generation fences account replacement | ok |
| REG-797 | macOS managed DIRECT | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+Direct.swift:30 | Combined assistant protected suffixes preserve parent/child DIRECT exclusion; #867 separately addresses process rules | ok |
| REG-799 | macOS WebSocket | — | apps/macos/Tono/Core/CoreWebSocket.swift:99 | Receive failures mark observer stale before reconnect; callbacks never change protection. | ok |
| REG-802 | macOS catalog switch | P2 | apps/macos/Tono/Services/AppState+Catalog.swift:125 | Target rotation queues latest runtime rewrite; target disappearance can instead commit removed B then rewrite nil selection | concern: in-flight target removal overlaps pending #963 but needs app-level race proof |
| REG-804 | macOS node region UI | — | apps/macos/Tono/Views/NodeCardView.swift:33 | Optional first city avoids empty split trap and leaves unknown geography nil | ok |
| REG-818 | macOS rule parsing | — | apps/macos/Tono/Models/RuleEntry.swift:98 | Remaining component guard follows no-resolve removal; valid MATCH and non-MATCH imports remain admitted | ok |
| REG-826 | macOS diagnostic log upload | — | apps/macos/Tono/Services/DiagnosticsLogUploader.swift:499 | Empty owned chunk advances only local cursor and never uploads foreign records; backup continuation retained | ok |
| REG-835 | macOS uplink | — | apps/macos/Tono/Services/NetworkUplinkSnapshot.swift:183 | Link-local gateway normalized as DHCP gap; concrete service/interface/gateway moves still detected | ok |
| REG-836 | macOS DNS | — | apps/macos/Tono/Core/SystemProxy.swift:587 | Unreadable resolver files no longer discard known dynamic-store split DNS. | ok |
| REG-840 | macOS launch recovery | — | apps/macos/Tono/Core/RuntimeCleanup.swift:248 | Read timeout enters bounded existing repair; root install/update guards remain intact | ok |
| REG-854 | macOS initial persistence | — | apps/macos/Tono/Services/AppState+Persistence.swift:12 | Initial snapshot application is claimed before await; every scene joins one task | ok |
| REG-857 | macOS parser property tests | — | apps/macos/TonoTests/ParserPropertyTests.swift:5 | Bounded deterministic tests only; no macOS production parser or network behavior change | ok |
| REG-882 | macOS TUN wait | — | apps/macos/Tono/Services/AppState.swift:2291 | Cancellation checked after final poll sleep; #782 unstructured wait deliberately remains uncancelled | ok |
| REG-885 | macOS health monitor | — | apps/macos/Tono/Services/AppState+Connect.swift:1797 | Healthy probe clears only owned notice; probe seam preserves production implementation | ok |
| REG-889 | macOS helper | P1 | tooling/scripts/core-helper/KillSwitchManager.swift:557 | Failed accepted-barrier release omits selective AI hold. | duplicate of #1028 (merged; omission fixed) |
| REG-891 | macOS update monitor | — | apps/macos/Tono/Services/AppState+Connect.swift:720 | Missing-TUN monitor cannot release pending update; explicit Restore still allowed; exhausted helper preserves barrier guard | ok |
| REG-950 | macOS pin refresh | P1 | apps/macos/Tono/Services/AppState+Proxy.swift:519 | Successful sync followed by readiness failure skips exact PF convergence and blocks ordinary DIRECT traffic. | regression-fixed #1039 |
| REG-971 | macOS helper | — | tooling/scripts/core-helper/UpdateExecutor.swift:78 | Update recovery releases broad PF, restores DNS and applies the narrow AI hold. | ok |
| REG-991 | macOS update suspension | — | apps/macos/Tono/Services/AppState+NativeUpdate.swift:44 | Cancelled reload completion fenced then drained before slot retirement; pending update blocks competing teardown | ok |
| REG-993 | macOS update download | — | apps/macos/Tono/Services/NativeUpdateDownload.swift:27 | Whole-resource timer bounds drip metadata; package and verification behavior untouched | ok |
| REG-1008 | macOS credential persistence | — | apps/macos/Tono/Services/TonoAPIClient.swift:555 | Credential retry composes with #796 and termination waits after existing network cleanup under 20s bound | ok |
| REG-1027 | macOS WebSocket | — | apps/macos/Tono/Core/CoreWebSocket.swift:358 | Quiet logs no longer require unsupported Pong; traffic/connections and error recovery retained. | ok |
| REG-1028 | macOS helper AI recovery | — | tooling/scripts/core-helper/KillSwitchManager.swift:636 | Automatic failed-barrier and orphan release keep AI hold; DNS/update composition and contract remain correct. | ok |
| REG-1030 | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:984 | Nonblocking DNS preferences lock retains snapshot and helper/watchdog responsiveness. | ok |
| REG-1033 | macOS helper DNS restore/handoff | - | tooling/scripts/core-helper/ProtectedDNSManager.swift:321 | Saved-original equality retries production writer/Commit/Apply before retiring recovery; cap, external ownership, contention and tests retained. | ok |
| REG-1039 | macOS pin refresh | — | apps/macos/Tono/Services/AppState+Proxy.swift:540 | Own follow-up: independent reviews and exact-head native CI verify pins-only convergence before advisory readiness. | ok; merged #1039 |
| REG-1043 | macOS recovery owner | — | apps/macos/Tono/Services/Connection/ConnectionCoordinator.swift:161 | Own follow-up independently reviewed and exact-head native CI proves retry ownership fix. | ok; merged #1043 |

Own PRs:
- [#1039](https://github.com/raydocs/tono/pull/1039): merged04:32:26UTC, merge commit47ee7924, needs-hardware, merge-commit auto-merge enabled. Exact9329c82d native app build/XCTest, policy/helper jobs and ci-gate SUCCESS: https://github.com/raydocs/tono/actions/runs/36814696908 .
- [#1043](https://github.com/raydocs/tono/pull/1043): merged04:38:45UTC, merge commit933e7414, needs-hardware, merge-commit auto-merge enabled. Exact0d789d88 native app build/XCTest, policy/helper jobs and ci-gate SUCCESS: https://github.com/raydocs/tono/actions/runs/36815215051 .

**90 false positives / 100 unique behavior hypotheses** = 90 rejected + 3 verified (2 fixed, 1 real-unfixed) + 4 known duplicates + 3 unproved concerns. Review rows and finding aliases are not additional hypotheses. Full rejection reasons are in findings.tsv and audit notes.

Unfinished proof/acceptance:
- REG-802: removed in-flight catalog switch target; P2 concern awaiting app-level deterministic race proof, overlaps #963.
- REG-720-DIAL: proof checks remembered alternate B, connect may still select A; P2 concern awaiting app-level proof.
- REG-889-CAVEAT: pre-existing nonzero PF-load status caveat; native partial-commit reproduction unavailable.
- REG-794: real-unfixed legacy helper AI-preserving release compatibility.
- REG-760: previously recorded automatic full-disarm AI disposition remains a known design/contract note; not re-reported as a new finding.
- Native installed PF/TUN/DNS, crash/sleep/update, resolver activation and UI rendering acceptance unavailable locally. Hosted native CI passed own fixes, but hardware acceptance remains.
- Windows/control-plane portions of cross-platform PRs were outside this macOS slot.

Every matching merged PR at cutoff was reviewed in current source context. Source snapshots advanced from2bfa95d1 through933e7414. No deploy/publish/main mutation/other branch edits; no helper source changes in own fixes and no protocol bump needed.
