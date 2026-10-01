Audit baseline: initial current main cf5ee0d7; fix branches from fresh 64e8b593/ad8ab2cd. Source anchors refer to audited baseline and may shift after merges. No deploy/publish or helper contract changes. All assigned files read end to end; callers and callees followed. Native Swift/PF/DNS execution unavailable on Linux.

| ID | area | severity | file:line | one-line description | verdict |
|---|---|---|---|---|---|
| R4MA-RELOAD-FAILURE-BLOCK | macOS config reload | P1 | apps/macos/Tono/Services/AppState+Proxy.swift:718 | A single full reload failure stops the core but retains bootstrap PF and dead-loopback DNS through protected retries | real-fixed #1146 merged b5412bf4; native CI passed |
| R4MA-PIN-REFRESH-REVOKE | macOS DIRECT policy | P2 | apps/macos/Tono/Services/AppState+Catalog.swift:907 | Old DNS pin resolution can reinstall withdrawn DIRECT authority after a newer policy applies successfully | real-fixed #1153 merged e018c115; native CI passed |
| R4MA-MAC-UPDATE-COMMIT-RELEASE-RACE | macOS native update | P2 | apps/macos/Tono/Services/AppState+Connect.swift:1155 | Restore during dispatched native update Commit drains Commit then calls a rejected pending-only release leaving gates latched | real-unfixed #1151; native lifecycle qualification needed after #1099 |
| R4MA-CFG-FP01 | macOS config | — | apps/macos/Tono/Services/AppState+Catalog.swift:700 | Empty policy enables default DIRECT | false-positive initialDirectPolicy returns nil for an empty policy |
| R4MA-CFG-FP02 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:197 | Trusted Claude IP escapes DIRECT | false-positive earlier assistant TCP/CIDR and UDP-reject rules win |
| R4MA-CFG-FP03 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift:161 | Malformed or CA-only credentials reach Core | false-positive owned validation requires authenticated Reality/HY2; rejects skip-cert-verify |
| R4MA-CFG-FP04 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift:119 | Catalog name collides with generated groups | false-positive reserved names/tags are rejected |
| R4MA-CFG-FP05 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+Nodes.swift:145 | Duplicate normalized names crash Dictionary | false-positive normalized duplicate validation precedes dictionary creation |
| R4MA-CFG-FP06 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:81 | Invalid declared home route silently downgrades | false-positive runtime admission rejects unusable residential declarations |
| R4MA-CFG-FP07 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:145 | Residential SOCKS dials physical interface | false-positive SOCKS detours through Tono-Exit |
| R4MA-CFG-FP08 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:239 | Web-only policy enables native-app DIRECT | false-positive native rules are gated by nativeAppDirect |
| R4MA-CFG-FP09 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:88 | Unsupported transports fall back DIRECT | false-positive owned admission rejects unsupported or unauthenticated nodes |
| R4MA-CFG-FP10 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:281 | Public IPv6 escapes reviewed permits | false-positive public IPv6 is rejected; reviewed permit is inet-only |
| R4MA-CFG-FP11 | macOS config | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:283 | TUN exclusions grant arbitrary physical egress | false-positive exclusions remain exact/static and PF still restricts egress |
| R4MA-CFG-FP12 | macOS config | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:15 | Subscription YAML changes customer routing | false-positive production writer only emits owned sing-box JSON |
| R4MA-CFG-FP13 | macOS config | — | apps/macos/Tono/Core/CoreRuntimeManager.swift:8 | Serialization blocks SwiftUI | false-positive RuntimeConfigWriter performs bounded work on its own actor |
| MAC-ASSISTANT-DIRECT-GAP | macOS config | P1 | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:197 | No-home assistant DIRECT precedence | duplicate fixed #867 |
| AI-DIRECT-SUFFIX-GUARD-GAPS | macOS config | P1 | apps/macos/Tono/Core/Configuration/ConfigPipeline+Direct.swift:38 | Signed suffix covers protected assistants | duplicate fixed #797 |
| MAC-DASHSCOPE-DIRECT-COVERAGE | macOS config | P1 | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:175 | Alibaba DIRECT captures DashScope | duplicate fixed #1084 |
| MAC-SINGBOX-WEB-DIRECT-DNS | macOS config | P2 | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:216 | Real-IP DNS loses hostname routing identity | duplicate fixed #958 |
| MAC-WEB-PINS-SUFFIX-STALE | macOS config/catalog | P2 | apps/macos/Tono/Services/AppState+Catalog.swift:925 | Explicit suffix suppresses load-bearing web-pin refresh | duplicate known #1057 / MAC-WEB-PINS-SUFFIX-STALE |
| MAC-SINGBOX-DIRECT-BLACKHOLE | macOS config | P2 | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:155 | China DIRECT selector has no exit fallback | duplicate documented decision W1-grok-mac-config.md:14 |
| R4MA-CFG-REGIONAL-DNS-PARITY | macOS config | P2 | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:231 | Regional DNS resolver lacks redundancy | duplicate documented product-contract.md:136 parity gap |
| R4MA-CATALOG-BUSY-REMOVAL | macOS catalog | P2 | apps/macos/Tono/Services/AppState+Catalog.swift:339 | Catalog removal loses convergence behind mutation | duplicate issue #1113 |
| R4MA-POLICY-BUSY-DROP | macOS catalog | P2 | apps/macos/Tono/Services/AppState.swift:1846 | Accepted policy rebuild dropped while busy | duplicate issue #1114; fixed by merged #1149 |
| R4MA-CATALOG-FINGERPRINT | macOS catalog | P2 | apps/macos/Tono/Models/ProxyNode.swift:222 | Live catalog identity omits clientFingerprint | duplicate known MAC-CATALOG-SWITCH-TARGET-STALE limitation |
| R4MA-CATALOG-FP01 | macOS catalog | — | apps/macos/Tono/Services/Account/AccountSession+Auth.swift:457 | Late catalog response crosses accounts | false-positive account revision/cancellation checked before consumption |
| R4MA-CATALOG-FP02 | macOS catalog | — | apps/macos/Tono/App/TonoApp.swift:187 | Launch disk snapshot overwrites live refresh | false-positive ordinary launch awaits disk apply before account restore |
| R4MA-LIFECYCLE-FP01 | macOS wake | — | apps/macos/Tono/Services/AppState.swift:856 | Wake without catalog keeps permanent bootstrap block | false-positive helper selectively releases after three Core-down ticks |
| R4MA-LIFECYCLE-FP02 | macOS update | — | apps/macos/Tono/Services/AppState+Connect.swift:2327 | Omitted unarmed retry/watchdog reconnects during update | false-positive generation and connection-state gates reject stale work |
| R4MA-LIFECYCLE-FP03 | macOS launch | — | apps/macos/Tono/Services/AppState+LaunchProtection.swift:12 | Late launch verdict overrides live transition | false-positive live connected/connecting/disconnecting guard |
| R4MA-LIFECYCLE-FP04 | macOS launch | — | apps/macos/Tono/Services/AppState+LaunchProtection.swift:46 | Late unconfirmed status retires newer protection | false-positive launch-sequence and protection-generation fences |
| R4MA-UPDATE-TASK-RETIREMENT | macOS update | P2 | apps/macos/Tono/Services/AppState+NativeUpdate.swift:37 | Native update leaves wake/reload mutations alive | duplicate fixed #1001 / #991 |
| MAC-LAUNCH-REPAIR-DNS-SWEEP | macOS launch | P2 | apps/macos/Tono/Core/RuntimeCleanup.swift:390 | Launch restore skips missing DNS snapshot | duplicate fixed #756 |
| MAC-UPDATE-RECOVERY-AI-HOLD | macOS update | P1 | apps/macos/Tono/Services/AppState+Connect.swift:727 | Pending-update automatic cleanup removes AI hold | duplicate #1099 (now merged on ad8ab2cd) |
| MAC-UPDATE-OFFLINE-COMMIT-STUCK | macOS update | P2 | apps/macos/Tono/Core/RuntimeCleanup.swift:259 | Protected Offline successor cannot commit | duplicate open PR #795 |
| MAC-QUIT-AI-HOLD | macOS quit | P1 | apps/macos/Tono/App/AppDelegate.swift:356 | Ordinary Quit removes AI hold | duplicate decision issue #1052 |
| R4MA-SIGNEDOUT-AI-HOLD | macOS launch | P2 | apps/macos/Tono/Core/RuntimeCleanup.swift:354 | Signed-out cold launch removes recovery AI hold | duplicate issue #1117 |
| R3CONN-DEC01 | macOS DNS health | P2 | apps/macos/Tono/Services/AppState+Connect.swift:2568 | Supplemental DNS conflict intentionally stops Core and holds bootstrap protection | duplicate decision item #1057; helper later releases selectively |
| R4MA-PINS-POSTCOMMIT-HOLD | macOS pin reload | P2 | apps/macos/Tono/Services/AppState+Proxy.swift:697 | Committed-pin convergence failure retains preserved teardown and retry | duplicate documented MAC-PIN-REFRESH-TEARDOWN / #950 residual path; unchanged |

40 unique hypotheses: 19 false positives, 18 duplicates/documented gaps, 3 verified new findings. Two fixes shipped as PRs; one lifecycle race filed as #1151.

Both PRs merged through CI with merge-commit auto-merge; both retain needs-hardware. Exact receipts follow.

Unfinished: native execution and hardware acceptance; exhaustive audit of callees outside assigned scope. The #1151 native Commit/Restore race remains unfixed pending native lifecycle qualification.

PR #1146 merged as b5412bf4407f54efca32f528f1d2fcf25ae081ec. Merge-commit auto-merge enabled; needs-hardware retained. Exact source b15834739c6256c84237ff55f559c4661b802841; native CI checkout 35549aeb9746b4ea37a52962b2e7000c6b4b8ecd; ci-gate run 36828130533 SUCCESS, full 554 XCTest tests / 0 failures / 1 existing emitter skip. New full-reload regression passed. Local Swift execution unavailable; hosted evidence is separate from installed acceptance.

PR #1153 merged as e018c115860eec8951549351a1b492680a928577. Merge-commit auto-merge enabled; needs-hardware retained. Exact source a0bd191185045f53feb7f72812dff168163bd907; native CI checkout b888b0d462dabd72a9913e5db8f84f1c556ab83c; ci-gate run 36828821563 SUCCESS, full 554 XCTest tests / 0 failures / 1 existing emitter skip. New stale-pin regression passed.

Local verification: git diff --check and records parsers passed. Native tests ran on hosted macOS, not on this Linux VM. No deploy/publish, helper contract changes, source refactors, empty commits or gate changes.
