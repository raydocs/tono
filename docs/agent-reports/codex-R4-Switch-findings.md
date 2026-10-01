# R4-Switch: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:48 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1066 | hunt/sol-r4sw-connect-catalog-routing | needs-hardware | yes | fix(windows): rebuild residential routing rotated during connect |
| 1070 | hunt/sol-r4sw-protected-tcp-preflight | needs-hardware | yes | fix(windows): skip App TCP preflight behind retained protection |
| 1083 | hunt/sol-r4sw-bound-home-retirement | — | yes | fix(control-plane): refuse retirement of bound catalog homes |
| 1086 | hunt/sol-r4sw-mac-unarmed-target | needs-hardware | yes | fix(macos): reconnect to the proved TCP exit after release |
| 1098 | hunt/sol-r4sw-unarmed-selection | needs-hardware | yes | fix(windows): preserve newer selection after unarmed proof |
| 1103 | hunt/sol-r4sw-mac-catalog-ai-hold | needs-hardware | yes | fix(macos): preserve AI hold in catalog and policy cleanup |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4SW-MAC-BROWSER-AI-HOLD | macOS health | P1 | apps/macos/Tono/Services/AppState+Connect.swift:1646 | Browser DNS health release removed AI hold | duplicate of #1061 |
| R4-SW-WIN-SELFHEAL-SECOND-RELEASE | Windows connect | P2 | apps/windows/app/src-tauri/src/tono/connection.rs:275 | Self-heal repeats release after fail_connect | duplicate of #798 |
| R4-WIN-CONNECT-CATALOG-ROUTING | Windows catalog/connect | P1 | apps/windows/app/src-tauri/src/tono/connection/stages.rs:328 | Startup catalog rotation never rebuilt the old residential runtime | real-fixed #1066 |
| R4-WIN-PROTECTED-TCP-PREFLIGHT | Windows switch/reconnect | P1 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:242 | App TCP preflight cannot pass retained Core-only WFP protection | real-fixed #1070 |
| R4SW-CP-RETIRE-RELIST-TOKEN | Control plane retire/relist | P2 | services/control-plane/src/ops/reads/fleet.ts:268 | Stale retirement can revoke concurrently relisted token | duplicate fixed by other hunter in #1080 (Fixes #1072) |
| R4SW-CP-RELIST-SPKI | Control plane HY2 relist | P2 | services/control-plane/src/ops/reads/fleet.ts:290 | Synthesized relisted HY2 loses macOS SPKI pin | real-unfixed issue #1073; needs supplied or retained pin contract |
| R4SW-CP-BOUND-HOME-RETIRE | Control plane retirement | P1 | services/control-plane/src/ops/reads/fleet.ts:169 | Retirement ignored bound residential homeProxy dependency | real-fixed #1083 |
| REG-1048 | macOS reconnect | — | apps/macos/Tono/Services/AppState+Connect.swift:1646 | Selective automatic release composes with exhausted failures, but browser audit retains full user disarm | concern: browser Secure DNS AI hold omission covered by #1061 |
| REG-1043 | macOS reconnect | — | apps/macos/Tono/Services/AppState+Connect.swift:2283 | Cancellation and generation fences retire late TCP/status answers after Restore | ok |
| REG-891 | macOS update/reconnect | — | apps/macos/Tono/Services/AppState+Connect.swift:722 | Missing TUN monitor does not treat pending native update as explicit Restore | ok |
| REG-885 | macOS monitor/catalog | — | apps/macos/Tono/Services/AppState+Connect.swift:1806 | Healthy probes preserve unrelated catalog error notices | ok |
| REG-802 | macOS switch/catalog | — | apps/macos/Tono/Services/AppState+Catalog.swift:125 | Changed switch target queues latest catalog reload after switch convergence | ok |
| REG-781 | macOS residential catalog | — | apps/macos/Tono/Services/AppState+Catalog.swift:229 | Same-name residential dial identity changes now trigger existing runtime reload | ok |
| REG-760 | macOS reconnect | — | apps/macos/Tono/Services/AppState+Connect.swift:1646 | Browser conflict restores ordinary traffic but omits #1048 selective release intent | concern: browser Secure DNS AI hold omission covered by #1061 |
| REG-749 | macOS HY2 / Windows reconnect / Windows tono-core/macOS HY2 | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:122; apps/windows/app/src-tauri/src/tono/connection.rs:500; apps/windows/crates/tono-core/src/sing_box/runtime.rs:392 | HY2 keepalive remains emitted in current runtime without changing certificate pins; HY2 idle context is attached to failure evidence without changing release or node identity; Keepalive stamps every already-admitted HY2 outbound without changing DER/SPKI verification | ok |
| REG-744 | macOS runtime/catalog | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:234 | Alpha9 DNS/compiler changes compose with current fake-IP probe, delay gate and HY2 keepalive | ok |
| REG-720 | macOS reconnect | — | apps/macos/Tono/Services/AppState+Connect.swift:2319 | Unarmed retry can choose unprovable HY2 or prove TCP backup yet dial previous selection | regression-fixed #1086 |
| R4SW-MAC-PROOF-TARGET | macOS reconnect | P1 | apps/macos/Tono/Services/AppState+Connect.swift:2339 | Successful TCP proof of backup candidate reconnects unchanged previous selection | real-fixed #1086 |
| R4SW-MAC-HY2-PROBE | macOS reconnect | P1 | apps/macos/Tono/Services/AppState+Connect.swift:2319 | Remembered same-node HY2 candidate prevents all future eligible TCP retries | real-fixed #1086 |
| R4SW-MAC-RELEASE-WAIT | macOS reconnect | P2 | apps/macos/Tono/Services/AppState+Connect.swift:2316 | Unarmed retry returns forever if release teardown remains in progress after first 2s backoff | real-fixed #1086 |
| R4SW-MAC-SWITCH-CANCEL-CYCLE | macOS switch/reconnect | — | apps/macos/Tono/Services/AppState+Connect.swift:1975 | Monitor awaits failed switch while switch teardown drains monitor | false-positive switch returns before teardown; monitor is not awaiting teardown |
| R4SW-MAC-CATALOG-ID-REMAP | macOS switch/catalog | — | apps/macos/Tono/Services/AppState+Proxy.swift:176 | Captured switch node ID becomes stale after catalog parse reassigns IDs | false-positive selectedExitNode resolves current catalog by active name; queued reload uses new node |
| R4SW-MAC-HOME-ROTATE | macOS catalog | — | apps/macos/Tono/Services/AppState+Catalog.swift:235 | Same home route name hides residential credential rotation | duplicate of #781 |
| R4SW-MAC-POLICY-TEARDOWN | macOS catalog/reconnect | — | apps/macos/Tono/Services/AppState+Catalog.swift:615 | Traffic policy update tears down working tunnel before optional route applies | duplicate of open #966 |
| R4SW-MAC-REMOVED-EXIT | macOS switch/catalog | — | apps/macos/Tono/Services/AppState+Catalog.swift:149 | Vanished selected exit leaves general internet held without a surviving default | duplicate of open #963 |
| R4SW-MAC-AI-DIRECT-GUARD | macOS runtime | — | apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:177 | No residential hop leaves web AI inside reviewed-app broad direct routing | duplicate of codex2 AI-direct suffix guard in-flight per user |
| R4SW-MAC-RETRY-BACKOFF | macOS reconnect | P1 | apps/macos/Tono/Services/AppState+Connect.swift:2309 | Successful TCP then failed TLS/data-plane resets every automatic reconnect to first 2s delay | real-fixed #1086 |
| REG-1003 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1309 | Automatic health release preserves the AI hold and strict/policy exclusions | ok |
| REG-942 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:964 | Fresh aggregate projection prevents stale WFP snapshots from replacing newer state | ok |
| REG-715 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1392 | Non-strict health recovery restores internet and starts unarmed probing | issue #1095 |
| REG-787 | Windows catalog/reconnect | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:361 | Residential catalog changes rebuild Connected sessions; cleanup has a total 3-second bound | regression-fixed #1066 |
| REG-786 | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:62 | Revision-only policy republish retains heartbeat; empty graph skips before mutation | ok |
| REG-898 | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1264 | Cancellation ends stale controller reload waits while detached reconciliation owns admission | ok |
| REG-1010 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection.rs:681 | Guarded connect-failure release transfers writer and requests AI hold | ok |
| REG-1040 | Windows update/reconnect | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:267 | Automatic pending-update cleanup propagates AI hold through additive strict-checked operation | ok |
| REG-771 | Windows catalog | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:518 | Unicode-only names remain distinct while legacy ASCII identity folding survives | ok |
| REG-900 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection.rs:308 | New attempt clears committed signed-app path metadata before full tunnel startup | ok |
| REG-878 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1026 | Deferred events preserve baselines until debounce admits them | ok |
| REG-757 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:407 | Signed-app change refuses in-place recovery and moves through selective release after #715 | ok |
| REG-945 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:578 | Old-selection exit samples cannot overwrite a newly selected node | ok |
| R4-WIN-STALE-HEALTH-RELEASE | Windows switch/reconnect | P2 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397 | Old-exit failed proof crosses successful hot switch and releases the healthy replacement | real-unfixed issue #1095; P2 same-generation hot-switch overlap needs release authority fence |
| R4-FP-MONITOR-DETACHED-REPLACEMENT | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/state.rs:165 | Ordinary monitor replacement might leave old unregistered task alive | false-positive register_network_monitor detects own task and aborts all other replacements |
| R4-FP-DIRECT-REVISION-EQUALITY | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:205 | Policy equality might still depend on signed revision and stop heartbeat | false-positive validated TonoTrafficPolicy excludes server revision and #786 compares behavior |
| R4-FP-DIRECT-COMMIT-RESTORE-HANG | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1413 | Commit proof might still retain lifecycle beyond 55-second Restore UI bound | false-positive one stalled Core wait is bounded below UI release budget; >55 needs independent Service stalls |
| R4-FP-CATALOG-GROWTH-REBUILD | Windows catalog | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:199 | Unrelated node changes should restart residential runtime | false-positive unrelated growth/default hints deliberately preserve live session; home identity rotation is detected |
| R4-DUP-DIRECT-RENEWAL-RELEASE | Windows DIRECT | P1 | apps/windows/app/src-tauri/src/tono/connection/direct.rs:96 | DIRECT heartbeat failure restricts normal internet before monitor convergence | duplicate of #926 / issue #907 |
| REG-912 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/controller.rs:49 | SCM/BFE reads use bounded async probe and preserve original diagnosis on uncertainty | ok |
| REG-884 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/transaction.rs:34 | Connect absolute budget accounts for Core preparation and residential browser-DNS proof | ok |
| REG-718 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:236 | TCP proof before tunnel incorrectly runs inside retained protected WFP on cold reconnect | regression-fixed #1070 |
| REG-714 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:133 | Unarmed recovery requires TCP proof but can overwrite a manual selection made during proof | regression-fixed #1098; retry-backoff sibling tracked by claimed #1054 |
| REG-740 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/reconnect.rs:162 | Crash-release reconnect observes Service hint, current auth/catalog intent and captured generation | ok |
| REG-738 | Windows reconnect | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:46 | Automatic selective release remains separate from explicit user Restore semantics | ok |
| REG-871 | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:973 | Controller graph proof matches assistant domain/IP shield ahead of signed-app DIRECT rows | ok |
| R4-WIN-UNARMED-SELECTION | Windows switch/reconnect | P2 | apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:133 | Successful background proof overwrites a newer idle user node selection without generation change | real-fixed #1098 |
| R4-FP-CATALOG-SELECTED-CREDENTIAL-ROTATION | Windows catalog | — | apps/windows/app/src-tauri/src/tono/catalog_sync.rs:199 | Same-name unrelated exit credential rotation does not force immediate live restart | false-positive deliberate catalog growth/live-session preservation; health failure takes latest snapshot |
| R4-FP-DIRECT-JSON-RECURSION | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1647 | Nested controller DNS JSON might overflow recursive address collector | false-positive serde_json default recursion admission limit bounds nesting before collector |
| R4-FP-STALE-OPTIONAL-DIRECT-SKIP | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1511 | Old optional-policy resolution failure can write newer skip metadata | false-positive not verified: marker mutation has no proved traffic effect; proposed impact additionally needs a later independent NIC failure |
| REG-1036 | Windows catalog/reconnect | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:62 | Automatic vanished-exit teardown transfers its writer into AI-held release; explicit strict branch unchanged | ok |
| REG-791 | Windows catalog/reconnect | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:37 | Catalog teardown validates generation and choice then withdraws Connected; #1036 supplies AI hold | ok |
| REG-779 | Windows update/reconnect | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:372 | Failed Prepare release admits only the retired generation; #1040 carries AI intent through pending update | ok |
| REG-879 | Windows DIRECT | — | apps/windows/app/src-tauri/src/tono/connection/platform.rs:90 | Physical DIRECT choice skips down hardware NICs; all rejected candidates retain full-tunnel fallback | ok |
| R4-FP-UPDATE-CATALOG-SYNC-RESTART | Windows catalog/update | — | apps/windows/app/src-tauri/src/tono/commands/quit.rs:453 | Failed Prepare could leave account catalog and policy synchronization stopped forever | false-positive resync_after_cancelled_quit now restarts periodic sync for the live Ready account; #779 old remaining-limit note is superseded |
| REG-729 | Windows tono-core | - | apps/windows/crates/tono-core/src/sing_box/runtime.rs:124 | DER-pinned HY2 and tighter fake-IP template compose with later keepalive/TTL changes; active Windows still uses mihomo | ok |
| REG-741 | Windows tono-core/macOS compiler | - | apps/windows/crates/tono-core/src/sing_box/runtime.rs:738 | TTL/HTTP2 reuse keys accepted by service; combined mihomo digest regression passes | ok |
| REG-832 | Control-plane retire/catalog | P1 | services/control-plane/src/ops/reads/fleet.ts:223 | HY2 alias drain works for primary selections but sibling retirement ignores bound catalog-home users | regression-fixed #1083; sibling token race fixed in #1080; issue #1073 pin contract remains |
| R4SW-CATALOG-SAME-REV | Windows tono-core/catalog | - | apps/windows/crates/tono-core/src/catalog.rs:360 | Different YAML at the same fleet revision looked like an unsafe overwrite | false-positive per-account/device bodies deliberately install after full validation and ownership gates |
| R4SW-RESIDENTIAL-SANITIZE | Windows tono-core/catalog | - | apps/windows/crates/tono-core/src/catalog.rs:176 | Unknown or invalid home directives could sanitize to ordinary cloud routing | false-positive residential admission rejects before tracker/cache mutation |
| R4SW-SINGBOX-AI-DIRECT | Windows tono-core/sing-box | - | apps/windows/crates/tono-core/src/sing_box/runtime.rs:321 | No-home signed-app DIRECT lacks active mihomo assistant-domain guards | false-positive current Windows product has no build_runtime caller; blocked #203 owns future migration |
| R4SW-SINGBOX-HOME-UDP | Windows tono-core/sing-box | - | apps/windows/crates/tono-core/src/sing_box/runtime.rs:278 | HY2 UDP can bypass the declared residential TCP route in future Rust sing-box compiler | duplicate WIN-HY2-HOME-UDP-LEAK #783 explicitly records dormant sing-box gap |
| R4SW-INLINE-HY2-RETIRE | Control-plane catalog | - | services/control-plane/src/catalog-yaml.ts:695 | Retirement of base removes only the base from an inline group and retains its HY2 member | false-positive for customer outage; product compilers rebuild groups from admitted proxies and ignore this stale catalog artifact |
| R4SW-RETIRE-DEVICE-OCCUPANCY | Control-plane retire/catalog | - | services/control-plane/src/ops/verdict-facts.ts:254 | Newest account disconnected state can hide another connected device in retirement incident occupancy | false-positive for premature token revoke; actual drain reads both customer and per-device status before revoke |
| R4SW-PUBLISH-REALITY-FIELDS | Control-plane catalog | - | services/control-plane/src/catalog-yaml.ts:29 | Catalog PUT validates managed identity but permits incomplete VLESS Reality fields | duplicate #493 body explicitly records global PUT validation as an existing residual; administrator malformed input |
| R4SW-MAC-CATALOG-AI-HOLD | macOS catalog/switch | P1 | apps/macos/Tono/Services/AppState+Catalog.swift:379 | Automatic catalog removal and failed survivor-switch release remove AI floor | real-fixed #1103 |
| R4SW-MAC-OPTIONAL-AI-HOLD | macOS policy/reconnect | P1 | apps/macos/Tono/Services/AppState.swift:2031 | Optional Core replacement failure release removes AI floor | real-fixed #1103 |
