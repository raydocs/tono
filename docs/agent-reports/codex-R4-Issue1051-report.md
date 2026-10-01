#1051 remains unfixed because the current service cannot satisfy both constraints. Its AI hold returns without installation proof. Checked preinstallation would retain the full network block on failure; proceeding would expose AI. A protocol flag alone cannot resolve this tradeoff.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows App | P1 | monitor.rs:1397 | Automatic release leaves the stalled DIRECT reader active. | Real-unfixed #1051: AI-preserving release blocker |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows App | P2 | update.rs:277 | Failed Prepare omits immediate Connecting cleanup. | Real-unfixed #1051: same blocker |
| R4I1051-AI-RELEASE-PROOF | Windows Service | — | selective_layer.rs:61 | Selective completion does not prove installation. | Duplicate of #1046’s blocker |

Three portable regressions reproduced the defects and missing hold proof: **0 passed, 3 expected failures**. No runtime code changed.

- **PRs:** none; labels and auto-merge are not applicable.
- **Hypotheses examined:** 3; false-positive bug count: 0. Four proposed remedies were rejected.
- **Unfinished:** #1051’s runtime fix and native Windows verification. A prearmed selective backend needs broader lifecycle changes and hardware qualification.

[Detailed report](/workspace/w1-codex/out/R4-Issue1051/report.md) · [Test evidence](/workspace/w1-codex/out/R4-Issue1051/issue1051-proof.log)

Only the claim comment was posted; the operator notes prohibit additional comments. The precise blocker is retained in the report and `findings.tsv`.