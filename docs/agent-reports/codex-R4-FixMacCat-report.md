Three fixes merged. The fourth passes CI and awaits UI review.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4FMC-MAC-BUSY-POLICY | macOS | P2 | AppState.swift:1867 | Accepted policy lost behind busy mutation | Fixed in #1149 |
| R4FMC-MAC-BUSY-CATALOG-REMOVAL | macOS | P2 | Catalog.swift:336 | Removal loses runtime convergence | Fixed in #1158 |
| R4FMC-CP-RELIST-SPKI | Control plane | P2 | ops/reads/fleet.ts:367 | HY2 relist drops required SPKI pin | Fixed in #1167 |
| R4FMC-MAC-PINS-COMMIT-BLOCK | macOS | P1 | Proxy.swift:705 | Committed pins failure holds ordinary internet | Fixed in #1178; review pending |
| MAC-WEB-PINS-SUFFIX-STALE | macOS | P2 | Connect.swift:1734 | Suffix rules suppress needed pin refresh | Unfixed #1057; coordinated design required |
| R3CONN-DEC01 | macOS | P2 | Connect.swift:2568 | Supplemental DNS conflict retains broad block | Unfixed #1057; documented disposition needs review |
| R4FMC-MAC-DISCONNECT-TELEMETRY | macOS | P3 | Connect.swift:541 | Successful sessions omit disconnect telemetry | Unfixed #1174; separate session clock needed |
| PIN-REFRESH-REVOKE | macOS | P2 | Catalog.swift:907 | Stale DNS reply restores revoked grants | Duplicate; merged #1153 |
| UPDATE-FAILURE-AI-HOLD | macOS | P2 | Connect.swift:2283 | Pending-update release drops AI hold | Duplicate; merged #1099 |

| PR | Status | Labels | Auto-merge |
|---|---|---|---|
| [#1149](https://github.com/raydocs/tono/pull/1149) | Merged, CI passed | needs-hardware | MERGE enabled |
| [#1158](https://github.com/raydocs/tono/pull/1158) | Merged, CI passed | needs-hardware | MERGE enabled |
| [#1167](https://github.com/raydocs/tono/pull/1167) | Merged, CI passed | needs-hardware | MERGE enabled |
| [#1178](https://github.com/raydocs/tono/pull/1178) | CI passed; UI review pending | needs-hardware, ui-review | Disabled as required |

**28 hypotheses examined; 19 false positives.** The [full report and rejection log](/workspace/w1-codex/out/R4-FixMacCat/report.md) contains all rows and guard evidence.

Worker checks passed: 24 relevant tests and typecheck. Latest native macOS CI passed 561 tests with zero failures and one pre-existing skip. Real-device PF/DNS/HY2 validation remains unfinished, along with the three unfixed findings above. No deploy or publish.