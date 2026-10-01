# tono bug-hunt COVERAGE MAP

- Maintained by: the orchestrator executor. Started 2026-09-30 17:45 MT. Base: origin/main `c26025ec` (17:33 MT).
- **Append-only for other jobs.** The Codex account-1 job (7:17 PM MT) must add its areas under "## Codex acct-1 claims" at the bottom, then scan only areas whose **Wave-plan owner** is `codex1`, or areas still marked GAP.
- Risk: **H** = can cut the network, crash or hang a machine, weaken AI blocking, bypass auth, corrupt billing/persistence, or break update integrity. **M** = wrong data, stuck UI, leaks of low-sensitivity data. **L** = cosmetic or tooling.
- Goal: every H area scanned by **two different strong models** (Sol and Grok). M/L areas: at least one.

## Hunter keys (who already scanned what)

| Key | Model / harness | Source ledger |
|---|---|---|
| GLM | GLM-5.3, single-chunk (no cross-file reading), FP rate ~59% | /workspace/glm-bughunt/REPORT.md, scan_jobs*.txt |
| SOL1 | GPT-6.1 Sol xhigh (Codex acct 1), same chunks as GLM, FP ~34% | /workspace/sol-bughunt/REPORT.md |
| SOL2 | GPT-6.1 Sol ultra (Codex acct 2), FP ~7% | /workspace/sol2-bughunt/REPORT.md, findings.md, chunks.txt |
| GROK | Grok bug hunt, cloud agent bc-0a0f053a (PRs #766-772), broad and shallow | transcript /workspace/cloud-agent-transcripts/bc-0a0f053a-*.jsonl |
| theme | Topic cloud agents (fix owners, not systematic hunters): sing-box bc-c95400de, protocol bc-30050b5e, freeze bc-253cce82, roaming bc-3c5ccfd4, self-heal bc-87cee3f3, release bc-59436cf2, ops bc-d93aea8f/bc-dc82f3fd, telemetry bc-eb7fcbc6, login bc-c92a658e, continuity bc-af839834, UX bc-405aa38b | fleet-watcher-tick.md |

"Sol" counts SOL1 or SOL2. GLM is recorded but does **not** count toward the two-model goal: it is noisy and saw only its chunk. "light" means the hunter mentioned the area but did not review it systematically.

## Area map

Status: **2x** = Sol and Grok both scanned it. **1x-S** / **1x-G** = only Sol / only Grok. **GAP** = no strong model yet.

### macOS privileged helper (tooling/scripts/core-helper, helper-shared)
| ID | Risk | Files | Scanned by | Status | Open / in-flight PRs | Wave-plan owner |
|---|---|---|---|---|---|---|
| M1 | H | core-helper/main.swift, SocketServer.swift, HelperPower.swift, HelperHTTP.swift, helper-shared/PeerAuthorization.swift | GLM s01, SOL1 s01, SOL2 s07 (partial) | 1x-S | #763 #773 (glm), #691 (user, don't touch) | W2-grok-helper |
| M2 | H | KillSwitchPF.swift, KillSwitchManager.swift, KillSwitchTests.swift | GLM s02/s03, SOL1 s02/s03 | 1x-S | #761, #794 | W2-grok-helper |
| M3 | H | ProtectedDNSManager.swift, CoreManager.swift | GLM s04, SOL1 s04 | 1x-S | #765 | W2-grok-helper |
| M4 | H | UpdateTransaction/UpdateStorage/UpdateRuntime/UpdatePackage/UpdateExecutor.swift, UpdateTests.swift, CONTRACT.sha256 | SOL2 (s07-2), SOL1-R3 (2026-09-30) | 1x-S | #795 #971 | codex1 (Sol) + W2-grok-helper |

### macOS app (apps/macos/Tono)
| ID | Risk | Files | Scanned by | Status | Open / in-flight PRs | Wave-plan owner |
|---|---|---|---|---|---|---|
| M5 | H | Core/HelperManager.swift, HelperProtocolVersion.swift, PrivilegedRuntimeCoordinator.swift, RuntimeCleanup.swift, NetworkProtectionOperations.swift, CoreRuntimeManager.swift | SOL1 calib229, SOL2 s07+w03, GLM calib | 1x-S | #759, #794 | W1-grok-mac-runtime |
| M6 | H | Services/AppState+Connect.swift | GLM s05/s06, SOL1 s05/s06, GROK light (sleep/wake), theme freeze+self-heal | 1x-S (+G light) | #755 merged, #760, #720, #714, #782 | W1-grok-mac-runtime |
| M7 | H | Services/AppState.swift, Core/ExitHeal.swift, AppState+LaunchProtection.swift, AppState+Persistence.swift, Services/Persistence/* | SOL2 n04 | 1x-S | #778, #756 | W1-grok-mac-runtime |
| M8 | H | App/AppDelegate.swift, PhysicalNetworkReachability.swift, NetworkUplinkSnapshot.swift, KillSwitchService.swift, Connection/ConnectionCoordinator.swift, ProtectedReconnectSchedule.swift | GLM s07, SOL2 s07, GROK light, theme roaming | 1x-S (+G light) | #738 | W1-grok-mac-runtime |
| M9 | H | Core/ConfigPipeline.swift + Core/Configuration/*, Services/ConfigParser.swift, Core/ManagedTrafficPolicySignature.swift, Services/Catalog/*, ProviderRuleLoader.swift, ManagedDirectRefreshPolicy.swift | SOL2 n09, theme sing-box | 1x-S | #744, #730, codex2 ai-direct-suffix-guard (in flight) | W1-grok-mac-config |
| M10 | H | AppState+Catalog.swift, AppState+Proxy.swift, Core/SystemProxy.swift, AppState+NativeUpdate.swift, NativeUpdateDownload.swift, UpdateHandoffJournal.swift, UpdatePreparation.swift, App/AppUpdater.swift, AppState+Subscriptions.swift, SubscriptionManager.swift, Support/SubscriptionURLPolicy.swift, AppState+RouteChoices.swift | SOL2 w03/w04 (not SubscriptionManager, UpdateHandoffJournal, NativeUpdateDownload) | 1x-S (partial) | #774, #781, #785, #795, codex2 mac-catalog-switch-target (in flight) | W1-grok-mac-config |
| M11 | H | Services/AccountSession*.swift, Account/*, TonoAPIClient.swift, ControlPlanePath.swift, KeychainStore.swift, TonoIdentityProviders.swift | SOL2 x03, theme login | 1x-S | codex2 mac-account-token-fixes (in flight) | W1-grok-mac-config |
| M12 | M | ProtectedConnectivityVerifier.swift, ProtectedConnectivity.swift, ProtectedDNSProbe.swift, ProtectedSystemResolver.swift, TonoSidecarService.swift, Core/CoreWebSocket.swift, Core/CoreControllerClient.swift, ProxyService.swift | SOL2 x04/w04, SOL1 calib27 | 1x-S | #788, #762, codex2 mac-websocket-stall (in flight) | W1-grok-mac-config |
| M13 | M | CrashReporter.swift, DiagnosticsLogUploader.swift, DiagnosticsLogOwnership.swift, Diagnostics/*, LocalTrafficAudit*.swift, AppTrafficLedger.swift, ConnectionTelemetryBuffer.swift, AppRoutingResearch*.swift, AccountSession+Telemetry.swift | theme telemetry only | GAP | #725 | codex1 (Sol) |
| M14 | L | Views/*, Models/*, Support/* (crash-only bugs: force unwraps, index out of range, main-thread blocking) | none | GAP | UI PRs #717 #719 #721 | W2-sol-leftovers |

### Windows service (apps/windows/service)
| ID | Risk | Files | Scanned by | Status | Open / in-flight PRs | Wave-plan owner |
|---|---|---|---|---|---|---|
| W1 | H | core/windows_kill_switch.rs (now 6090 lines; old scans covered 1-3278) | GLM s08/s09, SOL1 s09, SOL2 s08 | 1x-S (lines >3278 GAP) | #733 merged, #740, #753, #769, #777, #791, #792 | W1-grok-win-wfp |
| W2 | H | core/wfp/mod.rs, core/wfp_model.rs, core/windows_security.rs | GLM s10, SOL2 s10 | 1x-S | #740 | W1-grok-win-wfp |
| W3 | H | core/manager.rs, core/netmon.rs + netmon/topology.rs, core/process.rs, core/proxy.rs, core/macos_kill_switch.rs | GLM s11, SOL2 s11 | 1x-S (process/proxy GAP) | #775, #715 | W1-grok-win-wfp |
| W4 | H | bin/service.rs, core/maintenance.rs, boot_session.rs, owner.rs, reconcile.rs, repair.rs, runtime.rs, desired.rs, structure.rs | SOL2 n01 | 1x-S | #792 | W1-grok-win-svc |
| W5 | H | core/dns/mod.rs (3406 lines; old scan covered 1-2022), dns/engine.rs, dns/native_apply.rs | GLM s13, SOL1 s13 | 1x-S (engine/native_apply GAP) | #754, #769 | W1-grok-win-svc |
| W6 | H | core/server/mod.rs, core/server/handlers.rs, core/auth.rs, client/mod.rs, client/windows_identity.rs, channel.rs (IPC privilege boundary) | none | GAP | – | W1-sol-win-trust |
| W7 | H | core/update.rs, update/gate.rs, update/security.rs, update_transaction.rs, update_wire.rs | SOL2 n02 | 1x-S | #776, #779, #793 | W1-grok-win-svc |
| W8 | H | core/runtime_generation/* (assets, staging, core_integrity, authenticode, owned_config), core/paths.rs | none | GAP | – | W1-sol-win-trust |
| W9 | H | bin/install_service.rs, install_service/update_executor.rs, update_journal.rs, bin/uninstall_service.rs, core/legacy_cleanup.rs, windows_legacy_cleanup.rs, NSIS installer | SOL2 n03a/n03b (not uninstall/legacy cleanup) | 1x-S | #776, codex2 win-installer-retry-candidates (in flight) | W1-grok-win-svc |

### Windows app (apps/windows/app, Tauri Rust + TS) and crates
| ID | Risk | Files | Scanned by | Status | Open / in-flight PRs | Wave-plan owner |
|---|---|---|---|---|---|---|
| A1 | H | src-tauri/src/tono/connection.rs (3728 lines, top-level orchestrator) | SOL2 (w02-3 touched it only) | GAP | codex2 win-connection-races (in flight) | W1-sol-win-app |
| A2 | H | tono/connection/{stages,switch,reconnect,transaction,controller,failure,heal,cleanup,platform,status,endpoints}.rs | SOL2 w02/n08, GROK light | 1x-S | #787, #718, #714 | W2-grok-win-app |
| A3 | H | tono/connection/{monitor,disconnect,probes}.rs, connection_health.rs, protected_probe.rs | GLM s12, SOL1 s12 | 1x-S | #757, #715 | W2-grok-win-app |
| A4 | H | tono/connection/direct.rs, policy_sync.rs, route_ledger.rs, connection_routes.rs, route_preferences.rs | SOL2 w01/x02 | 1x-S | #786 | W2-grok-win-app |
| A5 | H | tono/catalog_sync.rs, offline_grant.rs, commands/account.rs, credentials.rs, state.rs, transport.rs | SOL2 x02 (not credentials/state/transport), GROK (#771 catalog_sync) | 2x (partial) | #771, #791 | W1-sol-win-app (credentials/state/transport) |
| A6 | H | tono/commands/update.rs, update_handoff.rs, commands/quit.rs, feat/window.rs, lib.rs, bootstrap.rs, steps.rs, core/updater.rs | SOL2 n03b/n10, GROK (#772) | 2x | #772, #779, #784 | done (re-check in W2-grok-win-app) |
| A7 | H | src-tauri/src/core/service/{mod,install,owner}.rs, core/runstate/*, core/owner_identity.rs, core/manager/*, core/proxy_control.rs, core/sysopt.rs, core/tray/* | none | GAP | – | W1-sol-win-trust |
| A8 | H | tono/windows_dns.rs, encrypted_dns.rs, browser_dns.rs, signed_apps.rs, audit.rs, local_evidence.rs | SOL2 n08 (encrypted_dns only) | GAP (mostly) | #757 | W1-sol-win-app |
| A9 | H/M | tono/commands/{restore,terminal,diagnostics,support,catalog,connection_cmd,mod}.rs, telemetry.rs, diagnostics.rs, log_upload.rs, support_reports.rs, utils/* (schtasks.rs, server.rs, init.rs, dirs.rs, network.rs, singleton.rs) | none | GAP | #724 | W1-sol-win-app |
| A10 | M | apps/windows/app/src (TS: hooks, services, pages, tono-ui, providers) | GROK (#768 ws hook) | 1x-G | UI PRs #717 #723 #726 #731 #735 #739 | W1-sol-win-app (non-UI logic only) |
| A11 | H | crates/tono-core/src/{config,node,sing_box,sing_box/*}.rs, tono/connection_plan.rs | SOL2 n08, GROK light (connect layer), theme sing-box/protocol | 1x-S (+G light) | #783 merged, #741, #749 | W2-grok-win-app |
| A12 | H | crates/tono-core/src/{auth,policy,policy_signature,catalog,heal,connection,update_journal*,update_contract,recovery,network_disposition,customer_failure,credentials,protected_connectivity}.rs | none | GAP | – | W1-sol-win-trust |
| A13 | M | crates/tono-plugin-core (mihomo client), tono-authenticode, tono-logger | none | GAP | #670 (deps) | W1-sol-win-trust (authenticode), W2 (plugin-core) |

### Control plane, agents, ops (services/*)
| ID | Risk | Files | Scanned by | Status | Open / in-flight PRs | Wave-plan owner |
|---|---|---|---|---|---|---|
| C1 | H | control-plane/src auth.ts, oidc.ts, sessions.ts, access.ts, crypto.ts, request.ts, client-identity.ts, index.ts 683-1016 | SOL2 n05, GROK r1 | 2x | codex2 cp-logout-refresh-race (in flight) | done |
| C2 | H | index.ts 1-683, 1016-1756 | SOL2 x01, SOL1 calib20, GROK r1 | 2x | #758 merged | done |
| C3 | H | index.ts 1756-3793 (devices, reports, metering ingest) | SOL2 n07, GROK r1 | 2x | – | done |
| C4 | H | traffic-policy.ts, product-account.ts, ops/quota.ts, ops-usage-hours.ts, telemetry-window.ts, ops/{traffic-parse,traffic-write,ingest,ingest-hooks,ingest-limits,replay}.ts | SOL2 n06 (not ingest/traffic-write/replay), GROK r1 (metering) | 2x (partial) | #780 merged | W2-grok-agents (ingest/traffic-write/replay) |
| C5 | H | catalog.ts, catalog-yaml.ts, home.ts, releases/host.ts, env.ts, admin-worker.ts, retention.ts, signup-profile.ts, http.ts, errors.ts | GROK r1 (policy signing/replay) | 1x-G | #713 | W1-sol-cp |
| C6 | M | telemetry/*.ts, diagnostics-limits.ts, ops-timeseries.ts | GROK (#766), theme telemetry | 1x-G | #734 | W1-sol-cp |
| C7a | H | ops/{router,http,roles,token-admin,shared-admin*,platform}.ts, ops/shared-admin/*, ops/legacy-handlers/* (authz) | GROK (#770), theme ops (#716) | 1x-G | #716, #713 | W1-sol-cp |
| C7b | H | ops/{ledger,ledger-recon,fx,customers*,customers-device,change-receipts,node-identity,home-lines,assets,retire-dependencies}.ts, ops/handlers/*, ops/contract/* | GROK (#767) | 1x-G | – | W1-sol-cp |
| C7c | M | ops/{jobs,jobs-worker,cron,cron-state,verdict*,alerts*,reads*,live,releases*,slo-rollup,evaluate,adoption,weekly-picks,funnel,coverage,freshness,cache,flatten,worthwhile,candidates-rollup,service-families,exit-asns,job-redaction}.ts | theme ops, SOL1-R3 (2026-09-30) | 1x-S | #970 | codex1 (Sol) |
| C8 | H | control-plane/migrations/*, tooling/scripts/wipe-d1-in-order.mjs, restore-control-plane-d1-preview.sh | GROK light (focus list) | GAP | – | W1-sol-cp |
| C9 | M | control-plane/admin/*, public/*, preview/* | none | GAP | – | W1-sol-cp |
| E1 | H | services/exit-agent/reconcile_and_report.py | SOL2 n06/n07 | 1x-S | #780 merged | W2-grok-agents |
| E2 | M | services/home-agent/*, tooling/scripts/remote/*, provision-tono-node.py, provision-reality-node.rb | none | GAP | – | W2-grok-agents |
| O1 | L/M | services/ops-console/src (data correctness only; UI changes stay manual) | SOL1 calib139, theme ops | 1x-S | #737 #743 #745-748 (UI, manual) | W2-sol-leftovers |

### Tooling, release, CI
| ID | Risk | Files | Scanned by | Status | Open / in-flight PRs | Wave-plan owner |
|---|---|---|---|---|---|---|
| T1 | H | release-macos.sh, notarize-macos.py, publish-macos-appcast.mjs, upload-release-asset.mjs, publish-traffic-policy.mjs, publish-managed-catalog.rb, verify-release-gate.sh, windows-package-components.mjs, desktop-update-* / *-release.yml workflows | theme release (docs only) | GAP | #749 | W2-grok-agents + codex1 |
| T2 | M | tooling/scripts/sing-box/*, prepare/verify-macos-sing-box.sh, mihomo-adaptive/*, connect-bench | theme sing-box/protocol | GAP (hunt) | #742 | W2-grok-agents |
| T3 | M | .github/workflows/*, tooling/scripts/ci-gate-changes.mjs, test harness scripts | – | quality-gate agent | #790 merged | W1-qg |
| T4 | L | remaining tooling/scripts/*.sh|py|mjs (test runners, records.mjs, with-slot.sh, build-core-helper.sh) | none | GAP | – | W2-sol-leftovers |

## Summary (at 17:45 MT)
- **54 areas**: 41 H (A9 is mixed H/M), 10 M, 2 L, and O1 is L/M.
- **Double-covered (Sol + Grok): 6**. C1, C2, C3 and A6 are fully double-covered; A5 and C4 are partly.
- **Single strong model: 29**. 24 are Sol-only and 5 are Grok-only. Grok has "light" coverage on M6, M8, A2 and A11.
- **GAP (no strong model): 18**, 10 of them H: M4, W6, W8, A1, A7, A8, A9, A12, C8 and T1. T3 goes to the quality-gate agent and is not counted.
- GLM also scanned M1-M3, M6, M8, W1-W3, W5 and A3, but it does not count toward the goal.
- After wave 1 plus wave 2 plus codex1, every H area has Sol and Grok. The exceptions are W6, W8, A1, A7, A8, A9, A12 and C8: wave 1 gives them only a first Sol pass, and they need a **wave-3 Grok pass**, one slot per two areas.

## Wave plan
Wave 1 is the hunters plus the quality-gate agent, 8 concurrent. Wave 2 starts as wave-1 agents finish.

| Slot | Model | Areas | Why |
|---|---|---|---|
| W1-grok-win-wfp | Grok 4.7 | W1, W2, W3 | Adds Grok to Sol-only H areas; covers kill-switch lines >3278 |
| W1-grok-win-svc | Grok 4.7 | W4, W5, W7, W9 | Adds Grok to service lifecycle, DNS, update, installer |
| W1-grok-mac-runtime | Grok 4.7 | M5, M6, M7, M8 | Adds Grok to the macOS connect FSM and lifecycle |
| W1-grok-mac-config | Grok 4.7 | M9, M10, M11, M12 | Adds Grok to macOS config, catalog, update and account |
| W1-sol-win-trust | Sol (astra or strongest) | W6, W8, A7, A12, A13-authenticode | First coverage: IPC privilege boundary, integrity, signatures |
| W1-sol-win-app | Sol | A1, A8, A9, A10, A5-rest | First coverage for the connection orchestrator, DNS/audit and commands |
| W1-sol-cp | Sol | C5, C6, C7a, C7b, C8, C9 | Adds Sol to Grok-only control-plane areas; migrations |
| W1-qg | Grok 4.7 | T3 + quality gates | CI hardening, coverage, fuzz, DECISIONS split |
| W2-grok-helper | Grok 4.7 | M1, M2, M3, M4 | Starts after the helper backlog (#761 #763 #765 #773 #794 #795) drains, to avoid helper-version churn |
| W2-grok-win-app | Grok 4.7 | A2, A3, A4, A11 (+A6 recheck) | Adds Grok to the Windows app connection flow |
| W2-grok-agents → **reuse bc-0a0f053a now** (reply) | Grok (existing agent) | E1, E2, C4-rest, T1, T2 | Agents, ingest, release scripts; no new launch needed |
| W2-sol-leftovers → **reuse bc-7ab08cd1 now** (reply) | Grok (existing agent) | M14, O1, T4, A13-plugin-core | Low risk; one model is enough |
| codex1 | Sol (Codex acct 1, 7:17 PM job) | M4, M13, C7c, T1 (second pass) | Uncovered Sol areas that no cloud agent owns |
| W3-grok-trust | Grok 4.7 | W6, W8, A7, A12 | Second model after W1-sol-win-trust finishes |
| W3-grok-winapp2 | Grok 4.7 | A1, A8, A9, C8 | Second model after W1-sol-win-app / W1-sol-cp finish |
| W3-sol-grokonly | Sol | A10 (TS logic), plus any area the codex1 job did not reach | Fills the remaining single-model areas |

## Codex acct-1 claims
(Codex job: append "<area id> | started <time> | <branch prefix>" lines here.)

### Codex acct-1 claims (started 2026-09-30 19:18:41 MT)
M4 | started 19:18 | codex1/m4-
M13 | started 19:18 | codex1/m13-
C7c | started 19:18 | codex1/c7c-
T1 | started 19:18 | codex1/t1- (Sol second pass; Grok has R3-T1-grok)

### R3 slots (2026-09-30 19:19 MT)

| Area | Owner | Result |
|---|---|---|
| M4 | codex1 R3-M4 | scanned; 2 real → #971; credits cut mid-run |
| M13 | codex1 R3-M13 | claimed; credits cut before findings |
| C7c | codex1 R3-C7c | scanned; 1 real → #970 |
| T1 | codex1 R3-T1 | claimed; credits cut before findings |
