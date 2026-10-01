All three PRs merged through CI. Optional #1008 body editing failed twice because of `gh`’s deprecated Projects API; [replacement body saved here](/workspace/w1-codex/out/R3-M9M11/refresh-token-pr.md). No unpushed commits remain.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-ROTATED-TOKEN-DURABILITY | M11 | P1 | TonoAPIClient.swift:591 | Failed successor-token persistence can lose the session after normal exit | Fixed in [#1008](https://github.com/raydocs/tono/pull/1008) |
| MAC-DASHSCOPE-DIRECT-COVERAGE | M9 | P1 | ConfigPipeline.swift:114 | Hostname-bearing model API requests match Alibaba DIRECT suffix | Real-unfixed: coordinate signed-policy migration and recovery protection; helper edits forbidden |
| MAC-WEB-PINS-SUFFIX-STALE | M9 | P2 | AppState+Connect.swift:1726 | Suffix presence disables refresh of pins still used for dialing | Real-unfixed: existing reload interrupts all session streams; safer refresh design needed |
| R3CFG-H01 | M9 | — | ConfigPipeline+Runtime.swift:694 | Assistant DIRECT protection gap | Duplicate #867 |
| R3CFG-H02 | M9 | — | ConfigPipeline+Runtime.swift:243 | Imported runtime injection | False positive: production uses owned sing-box emitter |
| R3CFG-H03 | M9 | — | ConfigPipeline+Direct.swift:93 | Trusted suffix bypasses AI protection | False positive: protected-overlap guard runs first |
| R3CFG-H04 | M9 | — | ConfigPipeline+Nodes.swift:73 | Invalid residential hop silently falls back | False positive: admission and compilation reject it |
| R3CFG-H05 | M9 | — | ConfigPipeline+Nodes.swift:166 | Unsafe node fields reach runtime | False positive: fields validated before emission |
| R3CFG-H06 | M9 | — | AppState+Catalog.swift:1070 | DIRECT policy exceeds PF budget | False positive: complete endpoint budget trims pins |
| R3CFG-H07 | M9 | — | ConfigPipeline+Identity.swift:143 | DIRECT DNS lacks exit fallback | False positive: documented limitation; no global outage proved |
| R3CFG-H08 | M9 | — | CoreRuntimeManager.swift:8 | Discovery hangs UI | False positive: writer actor; ordinary indefinite hang unproved |
| R3CFG-H09 | M9 | — | ConfigPipeline+Write.swift:41 | Concurrent writes start wrong runtime | False positive: actor serialization and digest checks |
| R3CFG-H10 | M9 | — | ConfigPipeline+SingBoxProduct.swift:169 | Real DNS loses DIRECT hostname | Duplicate #958 |
| R3CFG-H11 | M11 | — | TonoAPIClient.swift:800 | Old bearer refusal suspends newer session | Duplicate #796 |
| R3CFG-H12 | M11 | — | KeychainStore.swift:30 | Locked Keychain appears empty | False positive: read errors propagate |
| R3CFG-H13 | M11 | — | AccountSession+Auth.swift:426 | Catalog worker drains itself | False positive: no reachable self-draining path |
| R3CFG-H14 | M11 | — | AccountSession+Auth.swift:602 | Inventory outage tears down runtime | False positive: background read failure |
| R3CFG-H15 | M11 | — | AccountSession+Auth.swift:610 | Old account result overwrites new account | False positive: ownership and request guards |
| R3CFG-H16 | M11 | — | TonoAPIClient.swift:1000 | Unrelated 403 blocks Connect | False positive: ordinary triggering producer unproved |
| R3CFG-H17 | M11 | — | TonoIdentityProviders.swift:96 | Apple cancellation blocks logout | False positive: DEBUG-only provider path |
| R3CFG-H18 | M11 | — | control-plane/sessions.ts:75 | Lost renewal response destroys session | Duplicate #314/#329 |
| R3CFG-H19 | M11 | — | KeychainStore.swift:90 | Migrated device identity remains shared | Duplicate H11-F2/#409 |
| R3CFG-H20 | M11 | — | AccountSession+Auth.swift:656 | Account refusal retains PF after stopping core | False positive: documented refusal design |
| R3CFG-H21 | M9 | — | AppState+Catalog.swift:468 | Older signed policy wins after restart | False positive: persisted and memory revision floors |
| R3CFG-H22 | M9 | — | TonoApp.swift:187 | Older catalog wins during startup | False positive: snapshot ordering and revision checks |
| R3CFG-H23 | M9 | — | AccountSession+Auth.swift:426 | Same-revision responses reorder routing | False positive: production refresh is single-flight |
| R3CFG-H24 | M9 | — | AppState+Catalog.swift:96 | Old-account catalog survives sign-out | False positive: ownership checks and cancellation drain |
| R3CFG-H25 | M9 | — | ConfigParser.swift:649 | Quoted managed fields misparse | False positive: managed producer contract excludes trigger |
| R3CFG-H26 | M9 | — | ProviderRuleLoader.swift:51 | Malformed provider rules route DIRECT | False positive: display-only loader |
| R3CFG-H27 | M9 | — | AppState+Catalog.swift:835 | Old pin refresh applies to new session | False positive: monitor cancellation/drain guards |

| PR | Delivery | Status | Auto-merge | Labels |
|---|---|---|---|---|
| [#1008](https://github.com/raydocs/tono/pull/1008) | Token persistence fix and two regressions | Merged; required CI green | Merge commit | None |
| [#1016](https://github.com/raydocs/tono/pull/1016) | Two unresolved finding records | Merged; CI green | Merge commit | None |
| [#1019](https://github.com/raydocs/tono/pull/1019) | Corrected evidence references | Merged; CI green | Merge commit | None |

**30 hypotheses examined: 22 false positives, five duplicates, three verified findings.** The macOS suite reported 513 tests, zero failures and one existing optional skip; both new regressions passed.

All assigned M9/M11 files were reviewed. Installed-device crash, restart and update testing remains unexecuted. No helper, routing, DNS, AI-protection or strict-mode changes were made. Full evidence is in [the saved report](/workspace/w1-codex/out/R3-M9M11/final-report.md).