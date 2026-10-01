**#1061 and #1112 merged with CI passing. #1089 remains open with auto-merge enabled, blocked by the checkout problem repaired on main in #1108.**

Locations below refer to finding baselines. IDs share the `R4FO-` prefix.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-BROWSER-AI-HOLD | macOS | P1 | AppState+Connect.swift:1646 | Browser health cleanup removed AI hold | Fixed in #1061 |
| MAC-UNARMED-CLEANUP-AI-HOLD | macOS | P1 | AppState+Connect.swift:975 | Failed-arm cleanup removed helper’s AI hold | Fixed in #1061 |
| WIN-SELECTIVE-SYSTEM-DIR | Windows | P2 | selective_layer.rs:279 | C-drive assumption omitted AI IP blocks | Fixed in #1089; CI blocked |
| WIN-RESTORE-IDLE-AI-HOLD | Windows | P2 | disconnect.rs:391 | Idle Restore skipped AI-rule removal | Fixed in #1112 |
| WIN-RELEASE-AI-DISPOSITION-CRASH | Windows | P2 | windows_kill_switch.rs:2812 | Interrupted release forgot AI disposition | Unfixed: #1077; durable recovery needed |
| MAC-SELECTIVE-CRASH-INTENT | macOS | P2 | KillSwitchManager.swift:577 | Helper death forgot pending AI application | Unfixed: #1078; durable contract needed |
| WIN-EXPLICIT-RELEASE-JOIN-AI-HOLD | Windows | P2 | disconnect.rs:224 | Joining Disconnect lost remove-AI intent | Unfixed: #1109; shared intent arbitration needed |
| MAC-LAN-SCOPE-PARSER | macOS | P2 | KillSwitchPF.swift:88 | Compiled interface scope missed by parser | Unfixed: #1131; native fixture and paired permit fix needed |
| MAC-UPDATE-EXPLICIT-JOIN-AI-HOLD | macOS | P2 | AppState+NativeUpdate.swift:77 | Pending automatic cleanup discarded Restore | Unfixed: #1132; verified pending-#1099 regression |
| MAC-UPD-BROWSER-HOLD | macOS | P2 | AppState+Connect.swift:722 | Pending-update cleanup lost AI disposition | Duplicate #1099; own #1105 closed |

| My PR | Status | Labels | Merge-commit auto-merge |
|---|---|---|---|
| [#1061](https://github.com/raydocs/tono/pull/1061) | Merged | needs-hardware | Enabled |
| [#1089](https://github.com/raydocs/tono/pull/1089) | Open; checkout blocked | needs-hardware | Enabled |
| [#1112](https://github.com/raydocs/tono/pull/1112) | Merged | needs-hardware | Enabled |
| [#1105](https://github.com/raydocs/tono/pull/1105) | Closed duplicate | needs-hardware | Inactive |

**97 merged PRs reviewed; 70 hypotheses examined:** 44 false positives, 14 duplicates, four fixes, five issue-backed unfixed findings, three unverified concerns.

The [complete report](/workspace/w1-codex/out/R4-FailOpen/report.md) contains every reviewed PR and false-positive reason. [findings.tsv](/workspace/w1-codex/out/R4-FailOpen/findings.tsv) and [prs.tsv](/workspace/w1-codex/out/R4-FailOpen/prs.tsv) are updated.

Unfinished qualification: real-device PF/WFP/DNS behavior, compiled PF/NIC fixtures, interrupted recovery timing, and the three unverified native concerns. Later merges beyond `9947450e` are outside this review.

Hunter: GPT-6.1 Sol (Codex CLI)