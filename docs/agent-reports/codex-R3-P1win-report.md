The P1 is verified but needs an AI-preserving release contract: cancellation alone opens AI sooner. No unsafe runtime patch shipped.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows recovery | P1 | `connection/monitor.rs:1397` | Stalled DIRECT reader delays automatic release | Real-unfixed; decision recorded in #1046 |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows update | P2 | `commands/update.rs:277` | Failed Prepare during Connecting omits prompt recovery | Real-unfixed; same AI-preservation blocker |
| WIN-REPLACEMENT-HEAL-STATE | Windows account | P2 | `commands/account.rs:359` | Replacement account retains prior fallback history | Duplicate of #1047; my duplicate removed |
| FP-DIRECT-CANCEL-LOSES-CLEANUP | DIRECT ownership | — | `connection/direct.rs:1335` | Cancellation abandons retraction | False positive; detached owner finishes cleanup |
| FP-HEAL-CREDENTIAL-LEAK | Account privacy | — | `commands/account.rs:359` | Retained fallback uses old credentials | False positive; old catalog/routing discarded |
| FP-HEAL-RESET-DISARMS-WFP | Protection state | — | `connection/heal.rs:36` | Healer reset removes native protection | False positive; advisory state is separate |

My PR: [#1046](https://github.com/raydocs/tono/pull/1046), documentation only, `needs-hardware`, **auto-merge off**, final-head CI pending.

Another hunter’s [#1047](https://github.com/raydocs/tono/pull/1047) covers replacement-account state; `needs-hardware` and merge-commit auto-merge enabled when checked.

Both recovery witnesses reproduced the defects. The replacement regression failed before and passed after the reset before deduplication.

**6 hypotheses examined; 3 false positives.** Unfinished: both recovery fixes require the selective-release contract. Native Windows/hardware validation was unavailable.

[Full report and evidence index](/workspace/w1-codex/out/R3-P1win/report.md)