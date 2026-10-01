# R3-RegMac: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 22:24 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1039 | hunt/sol-r3regm-pins-readiness | needs-hardware | yes | fix(macos): restore pins-refresh DIRECT permits before readiness |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| REG-774 | macOS proxy | — | apps/macos/Tono/Core/SystemProxy.swift:403 | Bounded proxy commands and guard coalescing retain prior cleanup paths. | ok |
| REG-788 | macOS sidecar | — | apps/macos/Tono/Services/TonoSidecarService.swift:312 | Reused unrelated PID is discarded; unreadable identity and owned-stop failure still refuse. | ok |
| REG-799 | macOS WebSocket | — | apps/macos/Tono/Core/CoreWebSocket.swift:99 | Receive failures mark observer stale before reconnect; callbacks never change protection. | ok |
| REG-836 | macOS DNS | — | apps/macos/Tono/Core/SystemProxy.swift:578 | Unreadable resolver files no longer discard known dynamic-store split DNS. | ok |
| REG-1027 | macOS WebSocket | — | apps/macos/Tono/Core/CoreWebSocket.swift:358 | Quiet logs no longer require unsupported Pong; traffic/connections and error recovery retained. | ok |
| REG-778 | macOS optional policy | — | apps/macos/Tono/Services/AppState.swift:1991 | Pre-sync optional policy errors restore original session PF; replacement marker precedes sync | ok |
| REG-781 | macOS catalog | — | apps/macos/Tono/Services/AppState+Catalog.swift:229 | Home node dial identity now contributes to reload decision; nil/default handling composes with #802 | ok |
| REG-782 | macOS pin refresh | — | apps/macos/Tono/Services/AppState+Proxy.swift:563 | Unstructured bounded utun wait shields postcommit PF convergence from cancellation; disconnect drains task | ok |
| REG-797 | macOS managed DIRECT | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+Direct.swift:30 | Combined assistant protected suffixes preserve parent/child DIRECT exclusion; #867 separately addresses process rules | ok |
| REG-802 | macOS catalog switch | P2 | apps/macos/Tono/Services/AppState+Catalog.swift:125 | Target rotation queues latest runtime rewrite; target disappearance can instead commit removed B then rewrite nil selection | concern: in-flight target removal overlaps pending #963 but needs app-level race proof |
| REG-835 | macOS uplink | — | apps/macos/Tono/Services/NetworkUplinkSnapshot.swift:183 | Link-local gateway normalized as DHCP gap; concrete service/interface/gateway moves still detected | ok |
| REG-882 | macOS TUN wait | — | apps/macos/Tono/Services/AppState.swift:2240 | Cancellation checked after final poll sleep; #782 unstructured wait deliberately remains uncancelled | ok |
| REG-891 | macOS update monitor | — | apps/macos/Tono/Services/AppState+Connect.swift:720 | Missing-TUN monitor cannot release pending update; explicit Restore still allowed; exhausted helper preserves barrier guard | ok |
| REG-950 | macOS pin refresh | P1 | apps/macos/Tono/Services/AppState+Proxy.swift:519 | Successful sync followed by readiness failure skips exact PF convergence and blocks ordinary DIRECT traffic. | regression-fixed #1039 |
| REG-794 | macOS helper upgrade | P1 | apps/macos/Tono/Core/HelperManager.swift:259 | Abandoned helper upgrade automatically performs full disarm and loses AI hold | concern: automatic release shares explicit disarm disposition; requires helper intent contract and legacy compatibility |
| REG-796 | macOS session auth | — | apps/macos/Tono/Services/TonoAPIClient.swift:564 | Superseded bearer refusal reuses current renewal; credential generation fences account replacement | ok |
| REG-840 | macOS launch recovery | — | apps/macos/Tono/Core/RuntimeCleanup.swift:248 | Read timeout enters bounded existing repair; root install/update guards remain intact | ok |
| REG-854 | macOS initial persistence | — | apps/macos/Tono/Services/AppState+Persistence.swift:12 | Initial snapshot application is claimed before await; every scene joins one task | ok |
| REG-885 | macOS health monitor | — | apps/macos/Tono/Services/AppState+Connect.swift:1797 | Healthy probe clears only owned notice; probe seam preserves production implementation | ok |
| REG-991 | macOS update suspension | — | apps/macos/Tono/Services/AppState+NativeUpdate.swift:44 | Cancelled reload completion fenced then drained before slot retirement; pending update blocks competing teardown | ok |
| REG-993 | macOS update download | — | apps/macos/Tono/Services/NativeUpdateDownload.swift:27 | Whole-resource timer bounds drip metadata; package and verification behavior untouched | ok |
| REG-1008 | macOS credential persistence | — | apps/macos/Tono/Services/TonoAPIClient.swift:555 | Credential retry composes with #796 and termination waits after existing network cleanup under 20s bound | ok |
| REG-804 | macOS node region UI | — | apps/macos/Tono/Views/NodeCardView.swift:33 | Optional first city avoids empty split trap and leaves unknown geography nil | ok |
| REG-818 | macOS rule parsing | — | apps/macos/Tono/Models/RuleEntry.swift:98 | Remaining component guard follows no-resolve removal; valid MATCH and non-MATCH imports remain admitted | ok |
| REG-826 | macOS diagnostic log upload | — | apps/macos/Tono/Services/DiagnosticsLogUploader.swift:499 | Empty owned chunk advances only local cursor and never uploads foreign records; backup continuation retained | ok |
| REG-857 | macOS parser property tests | — | apps/macos/TonoTests/ParserPropertyTests.swift:5 | Bounded deterministic tests only; no macOS production parser or network behavior change | ok |
| MAC-PINS-SYNC-READINESS | macOS pin refresh | P1 | apps/macos/Tono/Services/AppState+Proxy.swift:519 | Use the helper replacement receipt, owned tunnel and exact PF re-arm before advisory readiness. | real-fixed #1039 |
