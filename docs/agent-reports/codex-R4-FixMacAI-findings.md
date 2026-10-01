# R4-FixMacAI: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1136 | hunt/sol-r4fma-release-ai-hold | needs-hardware | yes | fix(macos): persist interrupted selective recovery intent |
| 1141 | hunt/sol-r4fma-resolver-ownership | needs-hardware | yes | fix(macos): preserve ownership and originals of selective resolver files |
| 1144 | hunt/sol-r4fma-snapshotless-dns-apply | needs-hardware | yes | fix(macos): activate committed DNS during snapshotless restore retry |
| 1154 | hunt/sol-r4fma-dns-retirement-proof | needs-hardware | yes | fix(macos): retain DNS ownership proof across repeated Disconnect cleanup |
| 1166 | hunt/sol-r4fma-upgrade-fifo | needs-hardware | yes | fix(macos): reject blocking special files in app upgrade validation |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4FMA-INTERRUPTED-AI-RELEASE | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:577 | Interrupted automatic release forgets pending AI hold | real-fixed #1136 |
| R4FMA-RESOLVER-OWNERSHIP | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:214 | Selective cleanup overwrites/deletes foreign AI resolver files | real-fixed #1141 |
| R4FMA-SNAPSHOTLESS-APPLY | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | Snapshotless restore retry reports success without activation | real-fixed #1144 |
| R4FMA-DUPLICATE-DNS-RESTORE | macOS app/helper | P2 | apps/macos/Tono/Services/AppState+Connect.swift:982 | Second Disconnect DNS restore clears foreign loopback resolver | real-fixed #1154 |
| R4FMA-UPGRADE-AI-HOLD | macOS app | P2 | apps/macos/Tono/Core/HelperManager.swift:258 | Abandoned upgrade explicitly drops automatic AI hold | real-unfixed #1071; legacy helpers lack selective release, retaining PF breaks availability; product/recovery-contract decision |
| R4FMA-UPGRADE-APP-FIFO | macOS app | P2 | apps/macos/Tono/Core/HelperManager.swift:1543 | Silent-upgrade app validation blocks on in-bundle FIFO | real-fixed #1166 |
| R4FMA-ROUTE-OWNERSHIP | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:206 | Selective cleanup deletes preexisting Claude-prefix routes without ownership | real-unfixed #1164; route takeover/original restoration needs native design and qualification |
| R4FMA-REMOVAL-DNS-RETRY | macOS helper | P2 | tooling/scripts/core-helper/main.swift:1351 | Removal deletes recovery helper despite failed DNS restore | real-unfixed #1165; split PF release from DNS-completion/removal proof needs native qualification |
| R4FMA-AUDIT-DNS-SCOPED-IP | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:1129 | Scoped IPv6 resolver rejected | false-positive Darwin inet_pton accepts scoped IPv6; existing M3-SCOPED-IP disposition |
| R4FMA-AUDIT-DNS-COUNT-CAP | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:147 | Read/save server count mismatch | false-positive enable validates the shared32-server cap before mutation |
| R4FMA-AUDIT-DNS-SNAPSHOT-FIFO | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:640 | Snapshot FIFO blocks initial open | false-positive lstat type validation quarantines nonregular snapshot before opening |
| R4FMA-AUDIT-DNS-ID-FALLBACK | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:810 | Stable service-ID read failure restores another name owner | false-positive stable-ID error does not fallback to a service name |
| R4FMA-AUDIT-DNS-QUARANTINE-RETRY | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:497 | Quarantine removes automatic DNS retry evidence | duplicate known #1063 residual; subsequent-response fix #1144 does not claim retry scheduling |
| R4FMA-AUDIT-DNS-SUPERSEDED-SAVE | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:421 | Superseded re-enable save failure loses ownership proof | duplicate known #1097/#1154 limitation; separate fault path disclosed |
| R4FMA-AUDIT-DNS-DIRECTORY-FSYNC | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:733 | Snapshot rename lacks directory fsync | unverified native durability impact; no demonstrated user failure |
| R4FMA-AUDIT-DNS-NETWORKSETUP-STALL | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:1085 | Fallback networksetup can stall | unverified no realistic new trigger or native reproduction |
| R4FMA-AUDIT-UPDATE-UNARMED-DISPOSITION | macOS app | — | apps/macos/Tono/Services/AppState+Connect.swift:730 | Pending-update unarmed cleanup passes only automatic flag | unverified successful Stage cancels/drains Connect; remaining trigger requires extra failure or race |
| R4FMA-AUDIT-DISCONNECT-MONITOR-REARM | macOS app | — | apps/macos/Tono/Services/AppState+Connect.swift:857 | Monitor reassert arms after explicit Disconnect | false-positive Disconnect drains captured monitor task before release |
| R4FMA-AUDIT-UPGRADE-STOP-REPLY | macOS app | — | apps/macos/Tono/Core/HelperManager.swift:251 | Lost Core-stop reply skips deferred upgrade release | duplicate known #794 lost-reply limitation |
| R4FMA-AUDIT-STARTUP-DEAD-DNS | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:1126 | Failed helper startup leaves DNS listener absent | duplicate open #763 handles failed-startup DNS; not yet merged on audited main |
| R4FMA-AUDIT-STALE-CORE-EMERGENCY | macOS helper | — | tooling/scripts/core-helper/main.swift:987 | Emergency abort on SIGKILL-resistant stale Core | duplicate open #763 addresses stale-core emergency abort; not re-reported |
| R4FMA-AUDIT-SIGNEDOUT-AI-HOLD | macOS app | — | apps/macos/Tono/Services/Account/AccountSession+Auth.swift:41 | Signed-out cold launch drops selective hold | duplicate known issue #1117 |
| R4FMA-AUDIT-SELECTIVE-INSTALLER-RETRY | macOS helper | — | tooling/scripts/core-helper/KillSwitchManager.swift:647 | Installer failures lack every-tick retry | unverified recovery limitation; native failures documented best-effort, no concrete new fault reproduction or per-tick retry requirement proved |
| R4FMA-AUDIT-SELECTIVE-PREFIX-INJECTION | macOS helper | — | tooling/scripts/core-helper/SelectiveFailOpen.swift:111 | Prefix substring guard permits command injection | false-positive route argv comes from internal constant arrays |
| R4FMA-AUDIT-APP-PRESENCE-UNKNOWN | macOS helper | — | tooling/scripts/core-helper/main.swift:1178 | Unknown app-presence lookup triggers uninstall | false-positive unknown deliberately counts present, preventing removal |
| R4FMA-AUDIT-CORE-STOP-KERNEL-HANG | macOS helper | — | tooling/scripts/core-helper/CoreManager.swift:87 | Config-checker wait after SIGKILL could block | unverified requires SIGKILL-resistant kernel failure; actual Core shutdown is bounded |
| R4FMA-AUDIT-SHUTDOWN-STOP-ORPHAN | macOS helper | — | tooling/scripts/core-helper/SocketServer.swift:278 | Shutdown stop refusal strands helper ownership | unverified requires stop failure plus failed successor recovery |
| R4FMA-AUDIT-DNS-VALID-APPLY-RETRY | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:322 | Valid snapshot retry skips Apply | false-positive #1033 reapplies original values before retirement |
| R4FMA-AUDIT-DNS-UPDATE-ACTIVE-PROOF | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:245 | Update trusts stored DNS while active still loopback | false-positive verifyRestored reads active service DNS |
| R4FMA-AUDIT-CONNECT-UNARMED-PLAIN | macOS app | — | apps/macos/Tono/Services/AppState+Connect.swift:982 | Ordinary unarmed failed-connect cleanup uses plain disarm | duplicate merged #1061 selects AI-preserving cleanup; #1071 upgrade defer remains distinct |
| R4FMA-INTERRUPTED-EXPLICIT-AI-CLEANUP | macOS helper/app | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:633 | Interrupted explicit Restore suppresses apply but never resumes selective removal | real-unfixed #1169; preexisting, pending/completed removal and route ownership/native qualification required |
| R4FMA-AUDIT-FIFO-REFUSAL-AI-GAP | macOS app | P2 | apps/macos/Tono/Core/HelperManager.swift:259 | FIFO rejection reaches plain abandoned-upgrade cleanup | duplicate known #1071; modern Connect later reapplies AI, legacy/prompt-free callers cannot; early reorder lacks legacy recovery guarantee |
| R4FMA-AUDIT-FIFO-SIGNATURE-FALLBACK | macOS app | — | apps/macos/Tono/Core/HelperManager.swift:339 | Administrator fallback passes rejected FIFO to Security.framework | unverified Security.framework special-file behavior requires native evidence; path validator fixed in #1166, whole signing API hang not claimed |
