# R4-Issue1085: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1160 | hunt/sol-r4i1085-ai-tally | none | yes | fix(windows): scope AI tally accounts and bound flow receipts |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R3REGW-SELECTIVE-NETSH-PATH | Windows Service | P2 | apps/windows/service/src/core/selective_fail_open.rs:111 | Non-C system directory loses native AI IP hold | duplicate of #1089 |
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | Windows tally | P2 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48 | Replacement sign-in reads previous account local tally | real-fixed #1160 (merged 2e9eb35d; ci-gate passed) |
| R3REGW-AI-TALLY-SEEN-GROWTH | Windows tally | P3 | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:28 | Dedup receipts grow beyond bounded connection feed | real-fixed #1160 (merged 2e9eb35d; ci-gate passed) |
| R4I1085-OTHER-SYSTEM-PATHS | Windows Service | — | apps/windows/service/src/core/update/security.rs:180 | Other tool paths fixed to C drive | false-positive: OS system-directory scheduler; other literals are tests |
| R4I1085-NETSH-LOCALE | Windows Service | — | apps/windows/service/src/core/selective_layer.rs:333 | Localized netsh text breaks reconciliation | false-positive: only exit status inspected |
| R4I1085-ADAPTER-NAMES | Windows Service | — | apps/windows/service/src/core/dns/engine.rs:1888 | Renamed adapters prevent selective hold | false-positive: prefix and namespace rules use no adapter names |
| R4I1085-SELECTIVE-RELEASE-DELAY | Windows Service | — | apps/windows/service/src/core/selective_layer.rs:60 | Native selective wait prolongs general network block | false-positive: broad release precedes bounded wait; native worker best-effort limitation |
| R4I1085-LATE-STORAGE-DIGEST | Windows tally | — | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:60 | Late email digest overwrites current account key | false-positive: effect cleanup cancels setter and keyed.email guard rejects stale key |
| R4I1085-STALE-TALLY-STATE | Windows tally | — | apps/windows/app/src/tono-ui/AiTrafficCard.tsx:83 | Old tally state displays after current email changes | false-positive: render resets store and independently guards visible days |
| R4I1085-MISSING-AUTH-SCOPE | Windows tally | — | apps/windows/app/src-tauri/src/tono/route_preferences.rs:53 | No account lifetime scope available for cache isolation | false-positive: backend exposes opaque process and sign-in generation while ready |
| R4I1085-SELECTIVE-NRPT-POLICY | Windows Service | P2 | apps/windows/service/src/core/dns/engine.rs:1902 | Domain NRPT policy suppresses successful local AI suffix hold | real-unfixed: #1145; decision needed for enterprise NRPT enforcement |
