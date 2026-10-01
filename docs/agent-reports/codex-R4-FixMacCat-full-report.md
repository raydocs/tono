# R4-FixMacCat final report (2026-10-01)

Hunter: GPT-6.1 Sol (Codex CLI)

Three assigned fixes merged through CI. The adjacent P1 fix is PR #1178, CI passed; awaiting UI review; auto-merge disabled by the user’s UI rule. No deployments, publishing, device network changes, helper contract changes or main edits were performed.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4FMC-MAC-BUSY-POLICY | macOS policy | P2 | AppState.swift:1867 | Accepted policy lost behind runtime owner | real-fixed #1149 |
| R4FMC-MAC-BUSY-CATALOG-REMOVAL | macOS catalog | P2 | AppState+Catalog.swift:336 | Catalog removal lost behind active owner | real-fixed #1158 |
| PIN-REFRESH-REVOKE | macOS policy | P2 | AppState+Catalog.swift:907 | Old DNS resolution can restore revoked grants | duplicate of #1153 |
| R4FMC-CP-RELIST-SPKI | control-plane catalog | P2 | ops/reads/fleet.ts:367 | Relist strips macOS HY2 SPKI pin | real-fixed #1167 |
| MAC-WEB-PINS-SUFFIX-STALE | macOS config | P2 | AppState+Connect.swift:1734 | Suffix presence prevents refresh of still-used exact web pins | real-unfixed #1057 coordinated live DNS/pin design required; re-enabling full reload disrupts streams |
| R3CONN-DEC01 | macOS DNS | P2 design | AppState+Connect.swift:2568 | Supplemental DNS conflict tears down and holds general PF | real-unfixed #1057 documented product disposition; selective release plus truthful UI needs decision |
| R4FMC-MAC-PINS-COMMIT-BLOCK | macOS pins | P1 | AppState+Proxy.swift:705 | Successful pins replacement with missing tunnel preserves PF and dead DNS | real-fixed #1178 CI passed; UI review pending; auto-merge prohibited |
| R4FMC-MAC-DISCONNECT-TELEMETRY | macOS telemetry | P3 | AppState+Connect.swift:541 | Connect clears timestamp required by disconnectOk | real-unfixed #1174 lower-priority diagnostics; independent live-session clock needed |
| FP-CATALOG-ADDITIONS | macOS catalog | — | AppState+Catalog.swift:223 | Unrelated catalog additions strand runtime convergence | false-positive active endpoints unaffected; next selection writes the complete latest catalog |
| FP-CATALOG-ID-REMAP | macOS catalog | — | AppState+Catalog.swift:164 | Fresh parser IDs lose an existing switch target | false-positive remap by still-listed name preserves switch identity |
| FP-SWITCH-OLD-PROOF | macOS routes | — | AppState+RouteChoices.swift:71 | Old switch success proves a changed catalog | false-positive proof admission requires current catalog digest, owner and generation |
| FP-EMPTY-CATALOG-AI | macOS catalog | — | AppState+Catalog.swift:391 | No-survivor removal drops AI hold | false-positive automaticFailureRelease selects selective AI-preserving release |
| FP-REACTIVATION-PROOF | control-plane catalog | — | ops/shared-admin/exit-nodes.ts:117 | Reactivated exit keeps stale roster proof | false-positive disabled-to-active transition resets last_roster_at |
| FP-DISPLAY-IDENTITY | control-plane catalog | — | ops/node-identity.ts:72 | Display rename mutates catalog identity | false-positive only display_name changes; canonical name stays immutable |
| FP-HY2-HOME-ALIAS | control-plane catalog | — | catalog-yaml.ts:385 | HY2 alias exposes an unbound home exit | false-positive filtering checks both restricted exact name and folded base identity |
| FP-NORMALIZED-NAMES | macOS config | — | ConfigPipeline+Nodes.swift:145 | Emoji-normalized duplicate names crash dictionary construction | false-positive normalized duplicate names rejected before product dictionary creation |
| FP-LEFTOVER-GROUPS | macOS config | — | ConfigPipeline+SingBoxProduct.swift:54 | Filtered YAML leaves broken runtime group references | false-positive product rebuilds its adapters and groups from admitted nodes |
| FP-SOCKS-HOME | macOS config | — | ConfigPipeline+Nodes.swift:105 | SOCKS-backed home capability disappears | false-positive valid home SOCKS yields the residential terminal |
| FP-CIDR-SHIFT | macOS config | — | ConfigPipeline+Direct.swift:143 | Malformed CIDR traps bit shifting | false-positive prefix range and IPv4 parsing precede the shift |
| FP-AI-ANCESTOR | macOS policy | — | ConfigPipeline+Direct.swift:38 | DIRECT ancestor suffix bypasses protected AI domains | false-positive overlap checks both directions; narrow exception retains earlier AI routes |
| FP-LEGACY-RUNTIME | macOS config | — | CoreRuntimeManager.swift:15 | Legacy YAML or certificate relaxation reaches active product runtime | false-positive live writer always builds sing-box JSON; legacy generator has no app callers |
| FP-UNSIGNED-DIRECT | macOS policy | — | ConfigPipeline+Direct.swift:75 | Arbitrary unsigned web DIRECT input is admitted | false-positive unsigned entries require the allowlist; trust follows signature verification |
| FP-PORT-CONVERSION | macOS config | — | ConfigPipeline+Nodes.swift:167 | Port-to-UInt16 conversion crashes | false-positive owned admission bounds ports before conversion |
| FP-ADAPTER-COLLISION | macOS config | — | ConfigPipeline+Nodes.swift:119 | Imported node collides with a generated runtime adapter | false-positive reserved adapter names and fallback prefixes are rejected |
| FP-BUNDLE-REGEX | macOS config | — | ConfigPipeline+Identity.swift:515 | Bundle punctuation triggers regex assertion crash | false-positive commas and parentheses are escaped character by character |
| FP-CONFIG-UI-STALL | macOS config | — | CoreRuntimeManager.swift:8 | Synchronous signature/config generation freezes UI | false-positive live generation runs on the private RuntimeConfigWriter actor |
| FP-WATCHDOG-AVAILABILITY | macOS pins | — | SocketServer.swift:310 | Core watchdog prevents the committed-pins recovery outage | false-positive new Core starts reset the down counter; watchdog does not keep internet available throughout retry |
| UPDATE-FAILURE-AI-HOLD | macOS update | P2 | AppState+Connect.swift:2283 | Pending native update automatic release removes AI hold | duplicate of merged #1099; automatic provenance reaches selective update release |

| PR | State | Labels | Auto-merge |
|---|---|---|---|
| [#1149](https://github.com/raydocs/tono/pull/1149) / Fixes #1114 | Merged; CI passed | needs-hardware | Enabled, MERGE |
| [#1158](https://github.com/raydocs/tono/pull/1158) / Fixes #1113 | Merged; CI passed | needs-hardware | Enabled, MERGE |
| [#1167](https://github.com/raydocs/tono/pull/1167) / Fixes #1073 | Merged; CI passed | needs-hardware | Enabled, MERGE |
| [#1178](https://github.com/raydocs/tono/pull/1178) | Open; CI passed, UI review required | needs-hardware, ui-review | Disabled as required |

Verification: Worker regression actually failed before the HY2 fix and passed afterward; final relevant Worker suites: 24 passed, typecheck passed. Native macOS catalog CI build job 110263212748 ran the busy-policy and both catalog regressions, all passed: 557 tests, 0 failures, 1 pre-existing skip. No Swift or installed PF/DNS execution was available locally. PR1178 hosted ci-gate run 36832983461 passed at head0872f5c0/native merge checkout ca61962: both new regressions passed, 561 tests, 0 failures, 1 pre-existing skip; policy, privileged and runtime checks passed.

False positives: 19. Total distinct hypotheses: 28. Duplicate findings: 2.

Unfinished: both known #1057 rows require product/design disposition (live exact pins under suffix policy; deliberate corporate supplemental-DNS hold and truthful failure UI). New P3 #1174 needs a separate verified-session diagnostic clock; left to prioritize network safety. Final device PF/DNS/HY2 qualification remains pending. Scoped source audit completed across macOS Catalog/Connect/RouteChoices/Proxy and ConfigPipeline files plus control-plane catalog producers/callers. This is a bounded source audit, not full-system certification.

Artifacts: findings.tsv, prs.tsv, pins-pr-body.md, native-merged-regressions.txt, Worker before/after logs.
