| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-APP-FAILURE-AI-HOLD | macOS app/helper | P1 | AppState+Connect.swift:2270 | Automatic recovery removed the AI hold | Fixed and merged in [#1048](https://github.com/raydocs/tono/pull/1048) |
| MAC-DASHSCOPE-DIRECT-COVERAGE | Shared policy | P1 | ConfigPipeline.swift:114 | Dedicated model APIs match Alibaba DIRECT | Real-unfixed: needs coordinated policy/recovery changes; helper edits forbidden for this finding |
| MAC-AI-HOLD-DELIBERATE-RELEASE | Decisions | — | decisions/031:4 | Full AI release might be deliberate | False positive: owner decision requires selective recovery |
| MAC-AI-HOLD-WATCHDOG-REPAIR | Helper | — | KillSwitchManager.swift:579 | Watchdog might restore the hold | False positive: disarm deletes its required intent |
| MAC-AI-HOLD-1043-DUPLICATE | App | — | AppState+Connect.swift:2266 | #1043 might cover this bug | False positive: it only fixes retry ownership |
| MAC-DASHSCOPE-ALL-TUN-DIRECT | Routing | — | ConfigPipeline+SingBoxProduct.swift:224 | Every TUN request might go DIRECT | False positive: only hostname-bearing proxy path proved |

PR **#1048** merged through green CI with merge-commit auto-merge. `needs-hardware` is applied. Hosted XCTest reported **530 tests, zero failures, one existing opt-in skip**; the new regression passed.

**4 false positives; 6 hypotheses examined.** Unfinished: coordinated DashScope repair and installed-device acceptance.

[Full report and evidence](/workspace/w1-codex/out/R3-P1mac/report.md).