All three fixes merged through CI: **#1076, #1090 and #1099**. Each has `needs-hardware`; merge-commit auto-merge completed.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DNS-RETIRED-SNAPSHOT-REPLAY | Windows DNS | P2 | dns/mod.rs:2906 | Retained snapshots replayed old DNS settings | Fixed [#1076](https://github.com/raydocs/tono/pull/1076) |
| WIN-SCM-RETIREMENT-FAILURE-RELEASE | Windows WFP | P1 | server/mod.rs:652 | Metadata write failure skipped proven stop release | Fixed [#1090](https://github.com/raydocs/tono/pull/1090) |
| MAC-UPDATE-RECOVERY-AI-HOLD | macOS PF | P1 | AppState+Connect.swift:730 | Pending-update failure cleanup removed the AI hold | Fixed [#1099](https://github.com/raydocs/tono/pull/1099) |
| MAC-SELECTIVE-RESOLVER-OWNERSHIP | macOS DNS | P2 | SelectiveFailOpen.swift:206 | Recovery overwrites or deletes foreign resolver files | Unfixed [#1062](https://github.com/raydocs/tono/issues/1062): ownership contract needed |
| MAC-DNS-SNAPSHOTLESS-APPLY-RETRY | macOS DNS | P2 | ProtectedDNSManager.swift:361 | Snapshotless retry skips failed DNS activation | Unfixed [#1063](https://github.com/raydocs/tono/issues/1063): native qualification needed |
| MAC-DNS-DOUBLE-RESTORE-FOREIGN-LOOPBACK | macOS DNS | P2 | KillSwitchService.swift:333 | Second restore clears another local resolver | Unfixed [#1097](https://github.com/raydocs/tono/issues/1097): restore ownership contract needed |
| WIN-UNRECORDED-STOP-NONSTRICT-HOLD | Windows WFP | P1 | server/mod.rs:353 | Failed policy rebuild leaves non-strict blocking with no Core | Unfixed [#1139](https://github.com/raydocs/tono/issues/1139): documented fail-closed behavior requires a decision |

Reviewed **72 merged PRs and 84 hypotheses**: **57 false positives**, 13 duplicates and seven unverified concerns. The [complete report](/workspace/w1-codex/out/R4-RestoreDNS/report.md) contains every verdict and rejected hypothesis; [findings.tsv](/workspace/w1-codex/out/R4-RestoreDNS/findings.tsv) and [prs.tsv](/workspace/w1-codex/out/R4-RestoreDNS/prs.tsv) are synchronized.

Portable DNS tests passed **66/66**. Final macOS CI passed the app build, XCTest, policy and privileged helper suites. Real-device crash, sleep/wake, adapter-change, DNS/PF/WFP and disk-pressure testing remains unfinished.