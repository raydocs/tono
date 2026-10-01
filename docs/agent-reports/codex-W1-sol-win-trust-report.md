All five fixes merged through CI.

Metadata handoff: #843’s body update failed twice with GitHub’s Projects API error. Source is merged; no unpushed commits. Branch: `hunt/sol-trust-vault-write-retry`; title: “fix(windows): retry failed session vault mutations on flush”; [updated body](/workspace/w1-codex/out/W1-sol-win-trust/vault-pr-body.md).

Lines below refer to the audited baseline.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-VAULT-WRITE-RETRY | A12 | P1 | tono/credentials.rs:743 | Transient vault writes never retried | Fixed in [#843](https://github.com/raydocs/tono/pull/843) |
| WIN-OWNER-RELEASE-NONE | W6 | P1 | server/handlers.rs:415 | Missing owner record let release skip a running core | Fixed in [#873](https://github.com/raydocs/tono/pull/873) |
| WIN-RELEASE-SCM-PROBE-HANG | A7 | P1 | core/service/mod.rs:524 | Unbounded SCM reads hung lifecycle operations | Fixed in [#912](https://github.com/raydocs/tono/pull/912) |
| WIN-SCM-VERIFIER-WORKERS | W6 | P2 | client/mod.rs:165 | Timed-out SCM verifier threads accumulated | Fixed in [#933](https://github.com/raydocs/tono/pull/933) |
| WIN-GOODBYE-CONNECT-RACE | W6 | P2 | server/mod.rs:392 | Accepted shutdown still admitted new update work | Fixed in [#955](https://github.com/raydocs/tono/pull/955) |

All PRs used merge-commit auto-merge. #843 has no labels; the other four have `needs-hardware`. Each new regression failed before the fix and passed afterward.

**75 hypotheses examined: 61 false positives, nine duplicates, five verified fixes, zero new real-unfixed findings.** The [full 75-row report](/workspace/w1-codex/out/W1-sol-win-trust/report.md) includes complete paths, rejection reasons and test receipts.

All assigned areas were reviewed. Actual Windows hardware failure scenarios remain for the final device-testing batch; they cannot run in this Linux VM.