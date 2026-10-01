# R3-M9M11: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:05 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

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
| MAC-ROTATED-TOKEN-RETRY | M11 | P1 candidate | TonoAPIClient.swift:591 | Rotated token write refusal remains unpersisted until next refresh | investigating ordinary quit loses memory replacement |
