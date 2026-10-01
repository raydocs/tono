All five PRs merged through native macOS CI and the required ci-gate. Every PR used MERGE auto-merge and carries needs-hardware. Final resolver head069b6939 merged as50098a3b; main source/CONTRACT4.52.27 match exactly. No outstanding push/gh failure; no deployment/publication.

File lines refer to audited baselines recorded in PR/issue bodies; audit pointers checked against e018c115/28d9c26e. All new verified bugs are P2; no P0/P1 proved.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4FMA-INTERRUPTED-AI-RELEASE | macOS helper | P2 | tooling/scripts/core-helper/KillSwitchManager.swift:577 | Interrupted automatic release forgets pending AI hold | real-fixed #1136 |
| R4FMA-RESOLVER-OWNERSHIP | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:214 | Selective cleanup overwrites/deletes foreign AI resolver files | real-fixed #1141 |
| R4FMA-SNAPSHOTLESS-APPLY | macOS helper | P2 | tooling/scripts/core-helper/ProtectedDNSManager.swift:356 | Snapshotless restore retry reports success without activation | real-fixed #1144 |
| R4FMA-DUPLICATE-DNS-RESTORE | macOS app/helper | P2 | apps/macos/Tono/Services/AppState+Connect.swift:982 | Second Disconnect DNS restore clears foreign loopback resolver | real-fixed #1154 |
| R4FMA-UPGRADE-AI-HOLD | macOS app | P2 | apps/macos/Tono/Core/HelperManager.swift:258 | Abandoned upgrade explicitly drops automatic AI hold | real-unfixed #1071; legacy helpers lack selective release, retaining PF breaks availability; product/recovery-contract decision |
| R4FMA-UPGRADE-APP-FIFO | macOS app | P2 | apps/macos/Tono/Core/HelperManager.swift:1543 | Silent-upgrade app validation blocks on in-bundle FIFO | real-fixed #1166 |
| R4FMA-ROUTE-OWNERSHIP | macOS helper | P2 | tooling/scripts/core-helper/SelectiveFailOpen.swift:206 | Selective cleanup deletes preexisting Claude-prefix routes without ownership | real-unfixed #1164; route takeover/original restoration needs native design and qualification |
| R4FMA-REMOVAL-DNS-RETRY | macOS helper | P2 | tooling/scripts/core-helper/main.swift:1351 | Removal deletes recovery helper despite failed DNS restore | real-unfixed #1165; split PF release from DNS-completion/removal proof needs native qualification |
| R4FMA-AUDIT-DNS-SCOPED-IP | macOS helper | — | tooling/scripts/core-helper/ProtectedDNSManager.swift:1129 | Scoped IPv6 resolver rejected | false-positive [Apple public inet_pton wrapper](https://github.com/apple-oss-distributions/Libc/blob/main/net/inet_pton.c#L85) strips the zone suffix before IPv6 parsing |
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

| PR | Branch | Label | Auto-merge | Status |
|---|---|---|---|---|
| [#1136](https://github.com/raydocs/tono/pull/1136) | hunt/sol-r4fma-release-ai-hold | needs-hardware | yes (MERGE) | merged, native CI green |
| [#1141](https://github.com/raydocs/tono/pull/1141) | hunt/sol-r4fma-resolver-ownership | needs-hardware | yes (MERGE) | merged, native CI green |
| [#1144](https://github.com/raydocs/tono/pull/1144) | hunt/sol-r4fma-snapshotless-dns-apply | needs-hardware | yes (MERGE) | merged, native CI green |
| [#1154](https://github.com/raydocs/tono/pull/1154) | hunt/sol-r4fma-dns-retirement-proof | needs-hardware | yes (MERGE) | merged, native CI green |
| [#1166](https://github.com/raydocs/tono/pull/1166) | hunt/sol-r4fma-upgrade-fifo | needs-hardware | yes (MERGE) | merged, native CI green |

33 hypotheses: 9 verified (5 fixed in PRs,4 real-unfixed), 9 false positives, 7 unverified, 8 duplicates. Unverified candidates were not reported as bugs.

Checks: git diff --check, records parsers and exact19-source helper contract regeneration passed. FIFO extracted POSIX baseline blocks0.351s before cleanup (assertion failure); after source flags return immediately and fstat rejects it. Raw before/after logs retained. Native Swift unavailable on Linux; source regressions authored before implementations. Final macOS CI green at fb701feb/#1136, eec178a7/#1144, bc74d2c6/#1154,4c7a36a1/#1166; new FIFO XCTest passed0.013s. Final #1141 combined069b6939 preserves merged #1130 staging and #1135 LAN scope; build, policy, privileged and ci-gate all passed. Root lifecycle fixture passed; app suite559 tests/zero failures/one existing opt-in script-emitter skip. Current main50098a3b retains helper4.52.27 and exact CONTRACTc1907942…; no macOS/helper source differences from our branch. Raw final build/policy/privileged logs are retained.

Unfinished: compatible legacy upgrade AI release(#1071); native route ownership/takeover(#1164); helper-removal DNS completion/retry(#1165); interrupted explicit-removal completion/ownership(#1169); installed PF/DNS/TUN acceptance; exhaustive helper request-parser/power auditing; seven unverified candidates including Security.framework special-file behavior. A generic early source-validation reorder cannot claim legacy availability, so no additional mutation was made for that known1071 interaction. Assigned issues all reverified;1071 claimed once and left for disposition.

Hunter: GPT-6.1 Sol (Codex CLI)
