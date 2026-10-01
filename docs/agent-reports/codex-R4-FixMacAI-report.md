Five fixes merged through macOS CI and the required gate. Four verified bugs remain open. No P0/P1 was proved.

IDs below use the prefix `R4FMA-`. Helper paths are under `tooling/scripts/core-helper/`; app paths are under `apps/macos/Tono/`. Lines refer to audited baselines.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| INTERRUPTED-AI-RELEASE | Helper | P2 | KillSwitchManager.swift:577 | Interrupted release forgets pending AI hold | Fixed in #1136 |
| RESOLVER-OWNERSHIP | Helper | P2 | SelectiveFailOpen.swift:214 | Cleanup deletes foreign AI resolver files | Fixed in #1141 |
| SNAPSHOTLESS-APPLY | Helper | P2 | ProtectedDNSManager.swift:356 | Snapshotless restore skips DNS activation | Fixed in #1144 |
| DUPLICATE-DNS-RESTORE | App/helper | P2 | Services/AppState+Connect.swift:982 | Second Disconnect clears foreign loopback DNS | Fixed in #1154 |
| UPGRADE-AI-HOLD | App | P2 | Core/HelperManager.swift:258 | Abandoned upgrade drops AI hold | Unfixed [#1071](https://github.com/raydocs/tono/issues/1071): legacy-compatible recovery contract needed |
| UPGRADE-APP-FIFO | App | P2 | Core/HelperManager.swift:1543 | Upgrade validation blocks on writerless FIFO | Fixed in #1166 |
| ROUTE-OWNERSHIP | Helper | P2 | SelectiveFailOpen.swift:206 | Cleanup deletes preexisting Claude-prefix routes | Unfixed [#1164](https://github.com/raydocs/tono/issues/1164): owned takeover/restoration needs native qualification |
| REMOVAL-DNS-RETRY | Helper | P2 | main.swift:1351 | Removal deletes helper despite failed DNS restore | Unfixed [#1165](https://github.com/raydocs/tono/issues/1165): retain recovery until DNS completion |
| INTERRUPTED-EXPLICIT-AI-CLEANUP | Helper/app | P2 | KillSwitchManager.swift:633 | Interrupted Restore never resumes selective removal | Unfixed [#1169](https://github.com/raydocs/tono/issues/1169): pending/completed removal and ownership proof needed |
| AUDIT-DNS-SCOPED-IP | Helper | — | ProtectedDNSManager.swift:1129 | Scoped IPv6 rejected | False positive: [Apple’s wrapper strips the zone suffix](https://github.com/apple-oss-distributions/Libc/blob/main/net/inet_pton.c#L85) |
| AUDIT-DNS-COUNT-CAP | Helper | — | ProtectedDNSManager.swift:147 | Server-count limits differ | False positive: shared cap checked before mutation |
| AUDIT-DNS-SNAPSHOT-FIFO | Helper | — | ProtectedDNSManager.swift:640 | Snapshot FIFO blocks open | False positive: nonregular files quarantined before open |
| AUDIT-DNS-ID-FALLBACK | Helper | — | ProtectedDNSManager.swift:810 | Failed ID lookup restores another service | False positive: ID errors do not fall back by name |
| AUDIT-DISCONNECT-MONITOR-REARM | App | — | Services/AppState+Connect.swift:857 | Monitor re-arms after Disconnect | False positive: captured monitor task drained before release |
| AUDIT-SELECTIVE-PREFIX-INJECTION | Helper | — | SelectiveFailOpen.swift:111 | Prefix guard permits command injection | False positive: arguments come from internal constants |
| AUDIT-APP-PRESENCE-UNKNOWN | Helper | — | main.swift:1178 | Unknown presence triggers removal | False positive: unknown counts as present |
| AUDIT-DNS-VALID-APPLY-RETRY | Helper | — | ProtectedDNSManager.swift:322 | Valid snapshot retry skips Apply | False positive: #1033 reapplies originals |
| AUDIT-DNS-UPDATE-ACTIVE-PROOF | Helper | — | ProtectedDNSManager.swift:245 | Update trusts stored DNS only | False positive: verification reads active DNS |
| AUDIT-DNS-QUARANTINE-RETRY | Helper | — | ProtectedDNSManager.swift:497 | Quarantine removes retry evidence | Duplicate: known #1063 residual |
| AUDIT-DNS-SUPERSEDED-SAVE | Helper | — | ProtectedDNSManager.swift:421 | Failed re-enable save loses ownership proof | Duplicate: disclosed #1097/#1154 limitation |
| AUDIT-UPGRADE-STOP-REPLY | App | — | Core/HelperManager.swift:251 | Lost stop reply skips deferred cleanup | Duplicate: known #794 limitation |
| AUDIT-STARTUP-DEAD-DNS | Helper | — | KillSwitchManager.swift:1126 | Failed startup leaves dead DNS | Duplicate: open #763 |
| AUDIT-STALE-CORE-EMERGENCY | Helper | — | main.swift:987 | Stale Core aborts emergency recovery | Duplicate: open #763 |
| AUDIT-SIGNEDOUT-AI-HOLD | App | — | Services/Account/AccountSession+Auth.swift:41 | Signed-out launch drops selective hold | Duplicate: #1117 |
| AUDIT-CONNECT-UNARMED-PLAIN | App | — | Services/AppState+Connect.swift:982 | Failed Connect uses plain cleanup | Duplicate: merged #1061 |
| AUDIT-FIFO-REFUSAL-AI-GAP | App | P2 | Core/HelperManager.swift:259 | FIFO refusal reaches abandoned-upgrade cleanup | Duplicate: #1071; legacy recovery unresolved |
| AUDIT-DNS-DIRECTORY-FSYNC | Helper | — | ProtectedDNSManager.swift:733 | Snapshot rename lacks directory fsync | Unverified: native crash durability impact unproved |
| AUDIT-DNS-NETWORKSETUP-STALL | Helper | — | ProtectedDNSManager.swift:1085 | Fallback command may stall | Unverified: realistic trigger/native reproduction missing |
| AUDIT-UPDATE-UNARMED-DISPOSITION | App | — | Services/AppState+Connect.swift:730 | Pending-update cleanup lacks disposition | Unverified: Stage drains Connect; remaining path needs extra failure/race |
| AUDIT-SELECTIVE-INSTALLER-RETRY | Helper | — | KillSwitchManager.swift:647 | Installer failures lack repeated retry | Unverified: concrete new failure not reproduced |
| AUDIT-CORE-STOP-KERNEL-HANG | Helper | — | CoreManager.swift:87 | Config-checker wait may hang | Unverified: requires SIGKILL-resistant kernel failure |
| AUDIT-SHUTDOWN-STOP-ORPHAN | Helper | — | SocketServer.swift:278 | Stop refusal strands ownership | Unverified: needs failed stop and failed successor recovery |
| AUDIT-FIFO-SIGNATURE-FALLBACK | App | — | Core/HelperManager.swift:339 | Signing fallback receives rejected FIFO | Unverified: Security.framework behavior needs native evidence |

| PR | Fix | Status | Auto-merge | Label |
|---|---|---|---|---|
| [#1136](https://github.com/raydocs/tono/pull/1136) | Durable automatic AI-hold intent | Merged, CI green | MERGE | needs-hardware |
| [#1141](https://github.com/raydocs/tono/pull/1141) | Resolver ownership and original restoration | Merged, CI green | MERGE | needs-hardware |
| [#1144](https://github.com/raydocs/tono/pull/1144) | Snapshotless DNS activation retry | Merged, CI green | MERGE | needs-hardware |
| [#1154](https://github.com/raydocs/tono/pull/1154) | Repeated Disconnect DNS ownership proof | Merged, CI green | MERGE | needs-hardware |
| [#1166](https://github.com/raydocs/tono/pull/1166) | Nonblocking FIFO admission | Merged, CI green | MERGE | needs-hardware |

**33 hypotheses examined:** 9 verified, **9 false positives**, 8 duplicates, 7 unverified.

Local diff, records, contract and extracted FIFO checks passed. Swift was unavailable locally; hosted macOS CI passed the helper regressions and app tests. Final combined XCTest run had zero failures and one existing opt-in script-emitter skip. Main retains matching helper version/contract **4.52.27**.

Unfinished: the four open bugs above, installed-device PF/DNS/TUN acceptance, exhaustive parser/power auditing, and the seven unverified candidates. Strict-mode predicates and AI suffix/prefix coverage were preserved.

[Full report](/workspace/w1-codex/out/R4-FixMacAI/report.md), [findings.tsv](/workspace/w1-codex/out/R4-FixMacAI/findings.tsv), and [prs.tsv](/workspace/w1-codex/out/R4-FixMacAI/prs.tsv) are saved.

Hunter: GPT-6.1 Sol (Codex CLI)