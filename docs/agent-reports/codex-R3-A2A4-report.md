Two verified P1 fixes are pushed. Both PRs have `needs-hardware` and **merge-commit auto-merge enabled**; CI is still running, so neither is merged yet.

The #1003 body correction failed twice due to GitHub’s deprecated Projects GraphQL field. Branch: `hunt/sol-r3wconn-monitor-ai-hold`; title: “fix(windows): preserve AI hold after automatic health release”; [corrected body](/workspace/w1-codex/out/R3-A2A4/monitor-ai-hold-pr-body.md). Source and PR are already pushed.

Paths below are relative to `apps/windows/app/src-tauri/src/tono`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-MONITOR-AI-HOLD-OMISSION | A3 | P1 | `connection/monitor.rs:1391` | Automatic health release omitted the secondary AI hold. | Fixed in [#1003](https://github.com/raydocs/tono/pull/1003); CI pending |
| WIN-CONNECT-FAILURE-AI-HOLD-OMISSION | A2/A3 | P1 | `connection.rs:680` | Failed protected connect/cold switch performed a plain release without the AI hold. | Fixed in [#1010](https://github.com/raydocs/tono/pull/1010); CI pending |
| R3-A2-09 | A2 | P2 at most | `connection.rs:639` | Stale failure could clear a successor’s auth tunnel port. | Unverified; only a narrow scheduling race identified |
| R3-A4-15 | A4 | P2 at most | `connection/direct.rs:1497` | Old optional-policy skip could overwrite replacement metadata. | Unverified; ordinary successor overlap not proved |
| R3-A4-16 | A4 | P3 at most | `route_ledger.rs:46` | Empty-chain attribution disagrees with the frontend. | Decision item; actual route and intended attribution are unclear |
| R3-A4-01 | A4 | Known | `connection/direct.rs:973` | HY2 DIRECT proof expects an absent blanket UDP rejection. | Duplicate of acknowledged #783 follow-up |

The [full report and 40-row hypothesis table](/workspace/w1-codex/out/R3-A2A4/REPORT.md) contain every false-positive reason and duplicate reference.

**40 hypotheses examined:** two verified fixes, **25 false positives**, ten duplicates, three unverified candidates. Each fix has a failed-before/passed-after extracted production regression; three portable recovery tests also passed.

All assigned A2–A4 source files were read end to end. Windows native App/WFP/NRPT and real-device verification remain unfinished locally; hosted CI is running those checks.