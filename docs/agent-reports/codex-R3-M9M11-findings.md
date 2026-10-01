# R3-M9M11: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:15 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1008 | hunt/sol-r3cfg-refresh-token-durability | none | yes | fix(macos): recover rotated refresh-token durability before exit |
| 1016 | hunt/sol-r3cfg-unresolved-config-findings | none | yes | docs: record unresolved macOS pin and AI API routing findings |
| 1019 | hunt/sol-r3cfg-findings-source-anchors | none | yes | docs: correct macOS configuration finding source evidence |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R3CFG-H01 | M9 | — | ConfigPipeline+Runtime.swift:694 | Assistant domain/IP/process DIRECT guard gap | duplicate #867 |
| R3CFG-H02 | M9 | — | ConfigPipeline+Runtime.swift:243 | Imported subscription can inject runtime DNS/rules | false-positive production uses sing-box owned emitter; legacy path test-only |
| R3CFG-H03 | M9 | — | ConfigPipeline+Direct.swift:93 | Trusted suffix policy overlaps protected AI names | false-positive protected overlap guard precedes trusted allowlist bypass |
| R3CFG-H04 | M9 | — | ConfigPipeline+Nodes.swift:73 | Invalid required residential hop silently falls back | false-positive explicit invalid hop rejected at admission and compilation |
| R3CFG-H05 | M9 | — | ConfigPipeline+Nodes.swift:166 | Unsafe imported node fields reach runtime | false-positive protocol/TLS/IP/UUID/scalar/name validation before emission |
| R3CFG-H06 | M9 | — | AppState+Catalog.swift:1070 | Valid policy overflows session PF endpoint budget | false-positive pins trimmed against complete budget |
| R3CFG-H07 | M9 | — | ConfigPipeline+Identity.swift:143 | DIRECT DNS lacks exit fallback | false-positive explicit product limitation; no global Internet loss |
| R3CFG-H08 | M9 | — | CoreRuntimeManager.swift:8 | Bundle signature discovery hangs SwiftUI | false-positive compilation runs on writer actor; no ordinary indefinite hang proved |
| R3CFG-H09 | M9 | — | ConfigPipeline+Write.swift:41 | Concurrent config replacement starts wrong runtime | false-positive actor writer and helper digest snapshot reject mismatch |
| R3CFG-H10 | M9 | — | ConfigPipeline+SingBoxProduct.swift:169 | Web-direct real DNS loses hostname routing | duplicate #958 |
| MAC-ROTATED-TOKEN-DURABILITY | M11 | P1 | Services/TonoAPIClient.swift:591 | Rotated token write refusal remains unpersisted until next refresh | real-fixed #1008 |
| R3CFG-H11 | M11 | — | Services/TonoAPIClient.swift:800 | Delayed bearer refusal suspends newer session | duplicate #796 guards obsolete bearer verdicts |
| R3CFG-H12 | M11 | — | Services/KeychainStore.swift:30 | Locked Keychain mistaken for missing credential | false-positive read failures propagate; only item-not-found is absence |
| R3CFG-H13 | M11 | — | Services/Account/AccountSession+Auth.swift:426 | Catalog worker deadlocks by draining itself | false-positive no reachable self-draining cleanup call found |
| R3CFG-H14 | M11 | — | Services/Account/AccountSession+Auth.swift:602 | Background inventory outage tears down cloud runtime | false-positive inventory failure is a background read |
| R3CFG-H15 | M11 | — | Services/Account/AccountSession+Auth.swift:610 | Old inventory/account result overwrites newer account | false-positive owner/presentation revision/request-ID guards |
| R3CFG-H16 | M11 | — | Services/TonoAPIClient.swift:1000 | Endpoint-specific 403 blocks ordinary Connect | false-positive no ordinary non-entitlement 403 producer proved |
| R3CFG-H17 | M11 | — | Services/TonoIdentityProviders.swift:96 | Apple auth cancellation blocks logout | false-positive provider path is DEBUG-only |
| R3CFG-H18 | M11 | — | services/control-plane/src/sessions.ts:75 | Lost renewal response permanently destroys session | duplicate #314/#329; server predecessor replay grace exists |
| R3CFG-H19 | M11 | — | Services/KeychainStore.swift:90 | Migrated Keychain shares old device identity | duplicate H11-F2/#409 with hardware-anchor mitigation |
| R3CFG-H20 | M11 | — | Services/Account/AccountSession+Auth.swift:656 | Account refusal stops core while retaining PF | false-positive existing documented refusal design; known decision scope |
| R3CFG-H21 | M9 | — | Services/AppState+Catalog.swift:468 | Signed policy lower revision wins after restart | false-positive disk/memory trust and revision floors rechecked across awaits |
| R3CFG-H22 | M9 | — | App/TonoApp.swift:187 | Catalog older response wins during startup | false-positive disk snapshot loads before restore and revision checks span awaits |
| R3CFG-H23 | M9 | — | Services/Account/AccountSession+Auth.swift:426 | Same-revision older catalog routing arrives last | false-positive production refresh single-flight across fetch/validate/install |
| R3CFG-H24 | M9 | — | Services/AppState+Catalog.swift:96 | Old-account catalog persists after sign-out | false-positive epoch/ownership guards and cancellation slot drain |
| R3CFG-H25 | M9 | — | Services/ConfigParser.swift:649 | Quoted managed credential or name parses incorrectly | false-positive managed UUID and plain-name producer contract; alternate formats dev-only |
| R3CFG-H26 | M9 | — | Services/Catalog/ProviderRuleLoader.swift:51 | Malformed provider rules route traffic DIRECT | false-positive loader supplies rule search display only; owned runtime generates rules separately |
| R3CFG-H27 | M9 | — | Services/AppState+Catalog.swift:835 | Old session pin refresh applies to new session | false-positive disconnect cancels/drains monitor; refresh cancellation guard |
| MAC-WEB-PINS-SUFFIX-STALE | M9 | P2 | Services/AppState+Connect.swift:1726 | Suffix presence disables refresh of web pins still used for dialing | real-unfixed coordinated DNS/pin design needed to avoid documented whole-session reload interruption |
| MAC-DASHSCOPE-DIRECT-COVERAGE | M9 | P1 | Core/ConfigPipeline.swift:114 | Dedicated Qwen model API names match broad Alibaba DIRECT suffix | real-unfixed policy migration/recovery-domain coverage requires coordinated scope; helper edits forbidden |
