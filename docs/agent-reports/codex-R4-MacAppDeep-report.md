Two fixes merged through CI. One new finding remains open.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4MA-RELOAD-FAILURE-BLOCK | Config recovery | P1 | `AppState+Proxy.swift:718` | Failed reload kept bootstrap PF and dead DNS during retries | Fixed in [#1146](https://github.com/raydocs/tono/pull/1146) |
| R4MA-PIN-REFRESH-REVOKE | DIRECT policy | P2 | `AppState+Catalog.swift:907` | Old DNS completion could restore revoked DIRECT grants | Fixed in [#1153](https://github.com/raydocs/tono/pull/1153) |
| R4MA-MAC-UPDATE-COMMIT-RELEASE-RACE | Native update | P2 | `AppState+Connect.swift:1155` | Restore during Commit leaves stale update gates | Unfixed: [#1151](https://github.com/raydocs/tono/issues/1151), needs native lifecycle qualification |

Both PRs used merge-commit auto-merge and retain `needs-hardware`. Each passed hosted macOS CI: **554 tests, zero failures, one pre-existing skip**. Both new regressions executed and passed.

**40 hypotheses examined: 19 false positives, 18 duplicates/documented gaps, three new findings.** The [complete 40-row report](/workspace/w1-codex/out/R4-MacAppDeep/report.md) includes every rejected hypothesis, reason, duplicate reference, and CI receipt. [findings.tsv](/workspace/w1-codex/out/R4-MacAppDeep/findings.tsv) and [prs.tsv](/workspace/w1-codex/out/R4-MacAppDeep/prs.tsv) are current.

All assigned source files were read end to end. Installed-device PF/DNS/DIRECT acceptance and the #1151 lifecycle reproduction remain unfinished. No deployment or publication occurred.