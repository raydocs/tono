Two PRs merged through green CI. Both used merge-commit auto-merge and carry `needs-hardware`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4UPD-MAC-RETIRE-CLEANUP | macOS | P2 | UpdateTransaction.swift:407 | Failed executor cleanup loses retry ownership | Fixed in [#1064](https://github.com/raydocs/tono/pull/1064) |
| R4UPD-WIN-EXECUTOR-FAILURE-RELEASE | Windows | P1 | update_executor.rs:433 | Task registration failure skips selective release | Fixed in [#1075](https://github.com/raydocs/tono/pull/1075) |
| R4UPD-WIN-SUCCESSOR-FAILURE-HOLD | Windows | P1 | update_executor.rs:579 | Failed successor creation leaves ordinary traffic blocked | Fixed in [#1075](https://github.com/raydocs/tono/pull/1075) |
| R4UPD-MAC-UPGRADE-AI-HOLD | macOS | P2 | HelperManager.swift:259 | Abandoned helper upgrade removes AI blocking | Unfixed [#1071](https://github.com/raydocs/tono/issues/1071): legacy-compatible release needed |
| R4UPD-WIN-ROLLEDBACK-RECOVERY | Windows | P2 | update_executor.rs:385 | Interrupted rollback skips recovery finalization | Unfixed [#1081](https://github.com/raydocs/tono/issues/1081): needs replayable cleanup |
| R4UPD-WIN-CAPTURE-EARLY-HOLD | Windows | P2 | update_executor.rs:416 | Token-capture refusal bypasses failure cleanup | Unfixed [#1082](https://github.com/raydocs/tono/issues/1082): preserve unconsumed retry semantics |

Reviewed **32 merged PRs** and examined **44 hypotheses**: **26 false positives**, 12 duplicates, three fixed paths, and three unresolved findings.

Local checks passed: 14 journal tests and the failing-then-passing Windows finalizer regression. Native macOS and Windows CI passed. All assigned source areas were read; installed-device fault testing remains unfinished.

The [complete 76-row report and false-positive log](/workspace/w1-codex/out/R4-UpdateInstall/report.md) includes full source paths, evidence, and rejection reasons.