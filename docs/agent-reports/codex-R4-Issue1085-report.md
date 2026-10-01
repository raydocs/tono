[PR #1160](https://github.com/raydocs/tono/pull/1160) merged via merge-commit auto-merge as `2e9eb35d`. **CI passed; #1085 is closed.** Labels: none, because markup and network behavior are unchanged.

Both regressions failed before the fix. Seven focused tests, typecheck and lint passed afterward.

Locations below use baseline line numbers.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R3REGW-SELECTIVE-NETSH-PATH | Service | P2 | `selective_fail_open.rs:111` | Non-C Windows loses AI IP hold | Duplicate of merged #1089 |
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | Tally | P2 | `AiTrafficCard.tsx:48` | Replacement account sees prior tally | Fixed in #1160 |
| R3REGW-AI-TALLY-SEEN-GROWTH | Tally | P3 | `AiTrafficCard.tsx:28` | Historical receipts grow indefinitely | Fixed in #1160 |
| R4I1085-OTHER-SYSTEM-PATHS | Service | — | `update/security.rs:180` | Other C-drive tool assumptions | False positive: OS directory used; remaining literals are tests |
| R4I1085-NETSH-LOCALE | Service | — | `selective_layer.rs:333` | Localized output breaks reconciliation | False positive: exit status only |
| R4I1085-ADAPTER-NAMES | Service | — | `dns/engine.rs:1888` | Renamed adapters break hold | False positive: rules use no adapter names |
| R4I1085-SELECTIVE-RELEASE-DELAY | Service | — | `selective_layer.rs:60` | Selective wait prolongs broad blocking | False positive: broad release happens first |
| R4I1085-LATE-STORAGE-DIGEST | Tally | — | `AiTrafficCard.tsx:60` | Late digest overwrites account key | False positive: cancellation and email guard |
| R4I1085-STALE-TALLY-STATE | Tally | — | `AiTrafficCard.tsx:83` | Old tally survives email change | False positive: keyed store guard |
| R4I1085-MISSING-AUTH-SCOPE | Tally | — | `route_preferences.rs:53` | No account lifetime scope available | False positive: backend provides sign-in scope |
| R4I1085-SELECTIVE-NRPT-POLICY | Service | P2 | `dns/engine.rs:1902` | Enterprise NRPT suppresses local hold | Real-unfixed: #1145 needs an enforcement decision |

**11 hypotheses examined; 7 false positives.** Prior rejected hypotheses were retained without repeating their audits.

Unfinished: native Windows device acceptance and the NRPT decision. Unrelated lifecycle/installer code was not exhaustively audited.

[Full report and receipts](/workspace/w1-codex/out/R4-Issue1085/report.md).