Four fix PRs are pushed; **three merged with CI passing**. **#1107 remains blocked before native tests** by the known Windows checkout filename issue #1100; merge-commit auto-merge is enabled.

| ID | Area | Severity | File:line¹ | Description | Verdict |
|---|---|---|---|---|---|
| WIN-INSTALLATION-ID-DURABILITY | Account | P1 | account.rs:86–100 | Sign-in can use an undurable installation ID and evict another device | Fixed in [#1107](https://github.com/raydocs/tono/pull/1107); CI blocked |
| WIN-QUIT-STALE-RESYNC | Quit | P2 | commands/quit.rs:427 | Cancelled-Quit status read can reset a successor connection | Fixed, merged [#1111](https://github.com/raydocs/tono/pull/1111) |
| WIN-DIRECT-STALE-SKIP | Connection | P2 | connection/direct.rs:1511 | Late discovery failure clears successor DIRECT state | Fixed, merged [#1116](https://github.com/raydocs/tono/pull/1116) |
| WIN-TUNNEL-5XX-ANSWER | Transport | P2 | transport.rs:624–631 | Delivered API server errors are discarded as transport failures | Fixed, merged [#1128](https://github.com/raydocs/tono/pull/1128) |
| WIN-ACCOUNT-REPLACEMENT-AI-HOLD | Account | P1 | commands/account.rs:484–499 | Replacement sign-in removes the old runtime’s AI hold | Unfixed: product decision [#1120](https://github.com/raydocs/tono/issues/1120) |
| WIN-LATE-TIMEOUT-AI-HOLD | Cleanup | P2 | connection/cleanup.rs:45–56,143 | Late StartClash compensation can remove the automatic AI hold | Unfixed: native ordering qualification needed [#1134](https://github.com/raydocs/tono/issues/1134) |

¹ Audited pre-fix line references.

All four PRs had merge-commit auto-merge enabled. **#1111 and #1116 carry `needs-hardware`**; #1107 and #1128 have no labels. Every fix includes finding/changelog records and failing-then-passing regressions.

**46 hypotheses examined: 26 false positives, 14 duplicates, four fixes, two unfixed findings.** The [complete report and rejection reasons](/workspace/w1-codex/out/R4-WinAppDeep/report.md) contains the full 46-row table. Operator records are in [findings.tsv](/workspace/w1-codex/out/R4-WinAppDeep/findings.tsv) and [prs.tsv](/workspace/w1-codex/out/R4-WinAppDeep/prs.tsv).

All assigned source areas were read. Remaining work is real-device qualification, native timeout/sleep reproduction for #1134, the #1120 policy decision, and unblocking #1107’s native CI. No deployments, policy changes, or unpushed fixes remain.