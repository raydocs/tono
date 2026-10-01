# R4-CoreLib: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1148 | hunt/sol-r4core-yaml-sequence-maps | needs-hardware | yes | fix(windows): preserve proxy mappings with bracketed node names |
| 1157 | hunt/sol-r4core-singbox-fingerprint | needs-hardware | yes | fix(windows): accept omitted sing-box client fingerprints |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4CORE-H01 | policy | — | apps/windows/crates/tono-core/src/policy.rs:768 | Forged legacy revision permanently pins signed policy | duplicate H3-F5: signed embedded revision replaces unauthenticated ratchet (#342) |
| R4CORE-H02 | catalog | — | apps/windows/crates/tono-core/src/catalog.rs:365 | New account catalog body rejected at unchanged fleet revision | false-positive: equal revision/different digest installs fully validated per-account body |
| R4CORE-H03 | routing | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:225 | HY2 to VLESS hot switch retains UDP DIRECT fallback | duplicate WIN-HOT-SWITCH-PROTOCOL-CHANGE #783: transport mismatch now cold rebuilds |
| R4CORE-H04 | sing-box | P2 | apps/windows/crates/tono-core/src/sing_box/runtime.rs:271 | Residential HY2 UDP bypasses home TCP rule | duplicate WIN-HY2-HOME-UDP-LEAK: known shared compiler limitation; default enabled by #1140 |
| R4CORE-H05 | policy cache | — | apps/windows/crates/tono-core/src/policy.rs:902 | Concurrent policy cache writes collide on fixed temp path | false-positive: production policy install/cache store is serialized under TonoInner mutex |
| R4CORE-YAML-MAPPING-QUOTE | Mihomo config | P2 | apps/windows/crates/tono-core/src/config.rs:716 | Bracketed valid catalog names become invalid runtime YAML | real-fixed #1148; needs-hardware; auto-merge enabled |
| R4CORE-SINGBOX-OPTIONAL-FINGERPRINT | sing-box compiler | P1 | apps/windows/crates/tono-core/src/sing_box/runtime.rs:233 | Authenticated default sing-box rejects an admitted catalog with omitted VLESS fingerprint | real-fixed #1157; needs-hardware; auto-merge enabled |
| R4CORE-DNS01 | Windows DNS | — | apps/windows/app/src-tauri/src/tono/windows_dns.rs:46 | DNS callback storage expires while notifying completion | duplicate #828: callback retains its own Arc |
| R4CORE-DNS02 | Windows DNS | — | apps/windows/app/src-tauri/src/tono/windows_dns.rs:131 | DNS cancellation blocks Connect indefinitely | false-positive: outer timeout plus two-second cancellation wait bounds caller |
| R4CORE-DNS03 | browser DNS | — | apps/windows/app/src-tauri/src/tono/browser_dns.rs:152 | Profile Preferences omission misses Secure DNS | false-positive: supported desktop Chromium registers setting browser-wide in Local State |
| R4CORE-DNS04 | browser DNS | — | apps/windows/app/src-tauri/src/tono/browser_dns.rs:235 | Invalid local preference overrides managed policy | false-positive: managed policy wins before local preference type validation |
| R4CORE-DNS05 | signed apps | — | apps/windows/app/src-tauri/src/tono/signed_apps.rs:723 | Directory grants include user-writable installs | duplicate #633/#634: ancestor DACL checks narrow to exact files |
| R4CORE-DNS06 | signed apps | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:493 | Signed discovery stalls health monitoring | false-positive: separate pin-refresh task runs discovery on blocking pool |
| R4CORE-DNS07 | core plugin | — | apps/windows/crates/tono-plugin-core/src/stream.rs:153 | Named-pipe open bypasses WebSocket timeout | false-positive: default pipe context never served; customer controller switches to HTTP |
| R4CORE-DNS08 | core plugin | — | apps/windows/crates/tono-plugin-core/src/models.rs:10 | Unknown controller enums reject added values | false-positive: operational enums preserve unknown values; stricter config enums intentional |
