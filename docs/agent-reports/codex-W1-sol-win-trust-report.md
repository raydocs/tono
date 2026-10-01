All seven fixes merged into main through CI.

Metadata handoff: #843’s PR-body refresh failed twice in `gh pr edit`; its source merged. The [corrected body and handoff details](/workspace/w1-codex/out/W1-sol-win-trust/operator-handoff.md) are saved.

File locations below are before the fixes.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-VAULT-WRITE-RETRY | A12 | P1 | App `tono/credentials.rs:743` | Failed vault mutations were discarded instead of retried | Fixed in [#843](https://github.com/raydocs/tono/pull/843) |
| WIN-OWNER-RELEASE-NONE | W6 | P1 | Service `core/server/handlers.rs:415` | Missing owner record skipped live core shutdown | Fixed in [#873](https://github.com/raydocs/tono/pull/873) |
| WIN-RELEASE-SCM-PROBE-HANG | A7 | P1 | App `core/service/mod.rs:524` | SCM stall held the Disconnect release worker | Fixed in [#912](https://github.com/raydocs/tono/pull/912) |
| WIN-SCM-VERIFIER-WORKERS | W6 | P2 | Service `client/mod.rs:165` | Sustained SCM stalls accumulated verifier threads | Fixed in [#933](https://github.com/raydocs/tono/pull/933) |
| WIN-GOODBYE-CONNECT-RACE | W6 | P2 | Service `core/server/mod.rs:392` | Accepted shutdown still admitted new connections | Fixed in [#955](https://github.com/raydocs/tono/pull/955) |
| WIN-SELECTIVE-RELEASE-RETRY | A7 | P2 | App `core/service/mod.rs:1323` | Automatic retry could drop the selective AI hold | Fixed in [#983](https://github.com/raydocs/tono/pull/983) |
| AUTH-CLOCK-REPLAY-VERDICT | A12 | P2 | Core `auth.rs:1611` | Obsolete replay under clock skew rejected a valid rotated session | Fixed in [#990](https://github.com/raydocs/tono/pull/990) |

All seven were non-draft PRs with merge-commit auto-merge enabled. `needs-hardware` is applied to #873, #912, #933, #955 and #983; #843 and #990 have no labels.

**89 hypotheses examined:** 7 verified fixes, 73 false positives, 9 duplicates, 0 new real-unfixed findings. The [complete report](/workspace/w1-codex/out/W1-sol-win-trust/report.md) contains all 89 rows, rejection reasons and CI receipts.

Each regression failed before its fix and passed afterward. The final portable core suite passed 340 tests, and required Windows CI passed. No assigned source-audit area remains unfinished; real-device validation remains for the coordinated hardware batch.