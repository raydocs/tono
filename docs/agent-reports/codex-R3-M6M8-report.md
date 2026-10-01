| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-UPDATE-WAKE-RETIREMENT | M8 | P2 | AppState+NativeUpdate.swift:37 | Old wake task reconnects after explicit update release and retirement | Fixed in [#1001](https://github.com/raydocs/tono/pull/1001); CI pending |
| R3CONN-DEC01 | M6 | P2 | AppState+Connect.swift:2385 | Supplemental DNS conflict deliberately stops the session | Unfixed decision item; helper watchdog subsequently releases |
| R3CONN-DUP01–06 | M6/M8 | Existing | Multiple | Recovery, update and quit hypotheses already covered | Duplicates; references in full report |
| R3CONN-FP01–28 | M6/M8 | — | Multiple | Ownership, cancellation, reachability and lifetime hypotheses | Rejected or unproved; individual reasons in full report |

[Full 36-row report with exact locations and rejection reasons](/workspace/w1-codex/out/R3-M6M8/report.md).

**PR #1001:** non-draft, `needs-hardware` applied, merge-commit auto-merge enabled. One regression added. Local diff checks passed; hosted macOS jobs remain queued. PF/DNS/AI policy is unchanged.

**Counts:** 36 hypotheses; 28 false positives/unproved hypotheses; six duplicates; one decision item; one new fix.

**Unfinished:** native execution and hardware validation. M6/M8 source audit completed; Swift is unavailable here.