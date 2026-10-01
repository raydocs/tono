# ORCHESTRATOR FINDINGS LEDGER (tono industrial-grade hunt)

- Started 2026-09-30 17:50 MT, on main `c26025ec`.
- Columns: finding id | area (see COVERAGE.md) or platform | model | severity (verified) | verdict | PR (state).
- Verdicts: `fixed` (the PR is merged), `in-PR`, `real-unfixed` (with a reason), `FP`, `dup`, `decision` (needs a product decision).
- PR states were polled 17:55 MT. BEHIND/DIRTY states belong to the merge-side executor.

## A. New findings from this orchestration (waves 1-3)
| ID | Area | Model | Sev | Verdict | PR | Note |
|---|---|---|---|---|---|---|
| (none yet; agents not launched, see the blocker in the orchestrator report) | | | | | | |

## B. Prior: GPT-6.1 Sol, Codex account 2 (verified by the operator; source /workspace/sol2-bughunt/findings.md)
| ID | Area | Model | Sev | Verdict | PR (state) | Description [location] |
|---|---|---|---|---|---|---|
| s07-1 | macOS | Sol (SOL2) | - | FP: KeepAlive=true restarts helper; new helper releases leftover PF + restores DNS when core stopped (run() :108-116); update bootout deliberately keeps PF | - | SIGTERM exit stops core, leaves PF/DNS [SocketServer.swift:156-160] |
| s07-2 | macOS | Sol (SOL2) | P2 | real-new (not fixed: update-contract change) | - | protectedOffline update: new helper releases PF at start, so commit's observe()==.unprotected ≠ required .protectedOffline → commit throws, update stays pending, Connect blocked (network open) [RuntimeCleanup.swift:217-231; UpdateRuntime.swift:20-41; SocketServer.swift:108-116] |
| s08-1 | Win | Sol (SOL2) | P1 | in PR #740 (release restored wanted intent when core not running/proven) | #740 ? | service crash kills core, persistent WFP blocks until restart [wfp persistent filters; service crash] |
| s10-1/s11-2 | Win | Sol (SOL2) | P1 | real-new → PR #777 (codex2/win-direct-fail-open) | #777 OPEN | App crash/hang → committed DIRECT lease expires → Blocked forever (watchdog verifies Blocked as healthy) [windows_kill_switch.rs:2963-2983, 3035-3063] |
| s11-1 | Win | Sol (SOL2) | P1 | real-new → PR #777 (codex2/win-direct-fail-open) | #777 OPEN | intent write failure after live Blocked aborts stop_core/Disconnect/Release → offline until disk fixed [manager.rs:736-740; windows_kill_switch.rs:1867-1930, 2321-2337] |
| n01-1 | Win | Sol (SOL2) | P2 | real-new, design (not fixed; interacts with update/installer stop flows; reboot case in #740) | #740 ? | SCM Stop with session: stop_core leaves Blocked WFP + DNS [service.rs:441-460; server/mod.rs:448-457] |
| n01-2 | Win | Sol (SOL2) | P2 | in PR #740 (30 s core-proof window releases when tunnel permit not rendered) | #740 ? | single relock attempt after same-boot restart; flag cleared first [service.rs:683-686; windows_kill_switch.rs:2951-2957] |
| n01-3 | Win | Sol (SOL2) | - | FP: owner guard dropped before Stopped; successor terminates stale owner (owner.rs:78-83); no user impact | - | runtime drop waits for hung DNS worker after Stopped [service.rs:398-470] |
| n02-1 | Win | Sol (SOL2) | P2 | real-new but deliberate ("evidence and protection retained"; update Disconnect releases) – not fixed | - | update Prepare DNS-restore failure after core stop keeps bootstrap WFP [core/update.rs:455-469] |
| n02-2 | Win | Sol (SOL2) | P3 | real-new → PR #776 (codex2/win-installer-hangs) | #776 OPEN | retire_recovery_task hardcodes C:\Windows\System32\schtasks.exe; registration uses system dir [core/update.rs:976-986] |
| n03a-1 | Win | Sol (SOL2) | P2 | real-new → PR #776 (codex2/win-installer-hangs) | #776 OPEN | Runtime::new().block_on(manual_gate) drop waits on hung WFP blocking task → installer hangs holding repair gate [install_service.rs:1972] |
| n03a-2 | Win | Sol (SOL2) | - | unconfirmed/design (needs app-control rejection or crashing build); not fixed | - | service-only repair overwrites predecessor before proving replacement [install_service.rs:2042-2056] |
| n03a-3 | Win | Sol (SOL2) | P3 | real-new, not fixed (installer UX only) | - | rollback deletes .next candidates, NSIS auto-retry then always fails [install_service.rs:1352-1354; installer.nsi:815-860] |
| n03a-4 | Win | Sol (SOL2) | P3 | real-new → PR #776 (codex2/win-installer-hangs) | #776 OPEN | RebootRequired path checks strict protocol readiness of old service → exit≠3010 [install_service.rs:2050-2062] |
| n03b-1 | Win | Sol (SOL2) | P1 | real-new → PR #779 (codex2/win-update-failure-supervision) | #779 OPEN | Prepare failure before core stop leaves Connected with monitor+DIRECT heartbeat aborted → lease expiry → Blocked [app commands/update.rs:180-229] |
| n03b-2 | Win | Sol (SOL2) | - | FP (theoretical failure of Runtime::new/ChangeServiceConfig2) | - | Runtime::new / SCM recovery config failure after service stop [update_executor.rs:399-401,514-529] |
| n03b-3 | Win | Sol (SOL2) | P3 | real but double failure; not fixed | - | executor crash while successor CREATE_SUSPENDED [update_executor.rs:331-335,498-538] |
| n03b-4 | Win | Sol (SOL2) | P2 | unconfirmed design gap (needs broken release); not fixed | - | target service fails to start → no fail-open actor [update_executor.rs:345-350,507-540] |
| n03b-5 | Win | Sol (SOL2) | P3 | real-new → PR #779 (codex2/win-update-failure-supervision) | #779 OPEN | snapshot read failure skips Connecting fold → stuck Connecting [app commands/update.rs:221-228] |
| n05-1 | CP | Sol (SOL2) | P2 | real-new, latent (Google sign-in disabled in checked-in config); not fixed | - | Google email_verified on non-Google domain links to existing email account (reassigned mailbox) [oidc.ts:238-245; index.ts:887-967] |
| n05-2 | CP | Sol (SOL2) | P3 | real (narrow race); not fixed | - | logout vs concurrent refresh race leaves successor session live [index.ts:2450-2466; sessions.ts:32-40] |
| n04-1 | macOS | Sol (SOL2) | P1 | real-new → PR #778 (codex2/mac-optional-policy-fail-open) | #778 OPEN | optional-policy (managed DIRECT overlay) apply failure → disconnect(releaseKillSwitch:false): working core stopped, PF bootstrap-only, DNS dead until reconnect/watchdog [AppState.swift:1833-1907] |
| n06-1 | exit-agent | Sol (SOL2) | P2 | real-new → PR #780 (codex2/metering-undercount) | #780 MERGED | ACK failure before saving installedClients loses newly installed client; later revocation never removes it (no-listing xray) [reconcile_and_report.py:1733-1746] |
| n06-2 | exit-agent | Sol (SOL2) | P1 | real-new → PR #780 (codex2/metering-undercount) | #780 MERGED | after xray restart, absent labels keep stale raw baseline → permanent undercount [reconcile_and_report.py:1099-1128] |
| n06-3 | CP | Sol (SOL2) | P2 | real-new → PR #780 (codex2/metering-undercount) | #780 MERGED | expired-cycle rollover drops traffic since last sample [ops/quota.ts:307-320] |
| n06-4 | CP | Sol (SOL2) | P3 | known: issue #5 (counter generation needed); not fixed | - | reboot reset undetected when counter regrows past prev before next roll [ops/quota.ts:205-215] |
| n07-1 | CP | Sol (SOL2) | - | dup of n05-1 | - | = n05-1 (duplicate) [index.ts:944-966] |
| n07-2 | exit-agent | Sol (SOL2) | - | dup of n06-2 | - | = n06-2 (duplicate) [reconcile_and_report.py:1122-1127] |
| n07-3 | CP | Sol (SOL2) | P3 | real (legacy protocol v1 only; current agent sends v2); not fixed | - | retained v1 report replayed after a source counter reset re-bills history (v1 higher-total exception) [index.ts:3493-3580] |
| n08-1 | Win | Sol (SOL2) | P2 | real-new → PR #783 (codex2/win-hy2-routing) | #783 MERGED | home endpoint dedup by IP:port only drops home TCP permit when HY2 sibling selected [app connection/endpoints.rs:21-40; stages.rs:60-72] |
| n08-2 | Win | Sol (SOL2) | P2 | real-new → PR #783 (codex2/win-hy2-routing) | #783 MERGED | HY2 exit: no UDP REJECT, home rules TCP-only → assistant QUIC leaves via cloud exit, not residential [tono-core config.rs:1052-1084,1187-1194] |
| n08-3 | Win | Sol (SOL2) | P2 | real-new → PR #783 (codex2/win-hy2-routing) | #783 MERGED | hot switch VLESS↔HY2 keeps old UDP rule (no runtime rebuild) [app connection/switch.rs:139-281] |
| n09-1 | macOS | Sol (SOL2) | P2 | real-new → PR #781 (codex2/mac-home-proxy-reload) | #781 OPEN | homeProxy node params rotated under same name → no reload, stale residential route [AppState+Catalog.swift:199-222,233-260] |
| n09-2 | macOS | Sol (SOL2) | P3 | unconfirmed (sing-box semantics; sing-box product path is default-off); not fixed | - | real-IP DNS answers (hosts/China DNS) lose hostname; no sniff/reverse mapping → web-direct rules miss [ConfigPipeline+SingBoxProduct.swift:160-210] |
| n09-3 | macOS/CP | Sol (SOL2) | P3 | real (defense-in-depth; needs a signed bad policy); not fixed | - | protected-from-direct suffix list omits OpenAI/other assistants; a signed policy could route them direct [ConfigPipeline+Direct.swift:9-25; traffic-policy.ts:218] |
| n10-1 | Win | Sol (SOL2) | - | dup of s10-1 | - | = s10-1 (duplicate) [windows_kill_switch.rs:3035-3067] |
| n10-2 | Win | Sol (SOL2) | P2 | real-new → PR #784 (codex2/win-quit-fixes) | #784 OPEN | quit before protection discovery skips Service release; app exits leaving core/WFP/DNS [app commands/quit.rs:274-300; feat/window.rs:470-520] |
| n10-3 | Win | Sol (SOL2) | P3 | real-new → PR #784 (codex2/win-quit-fixes) | #784 OPEN | cancelled quit never restarts catalog/policy sync [app commands/quit.rs:278-281,313-336] |
| w01-1 | Win | Sol (SOL2) | P1 | real-new → PR #786 (codex2/win-direct-heartbeat-policy) | #786 OPEN | same-content policy revision changes raw digest → DIRECT heartbeat exits silently → lease expires → healthy session Blocked [app connection/direct.rs:62-64; policy_sync.rs:82-107] |
| w01-2 | Win | Sol (SOL2) | P1 | real-new (trigger depends on policy/pins) → PR #786 (codex2/win-direct-heartbeat-policy) | #786 OPEN | plan with suffix rows but no emitted controller rules passes empty check → bracket opens → empty-graph proof fails → Blocked/reconnect loop [app connection/direct.rs:495-503,825; tono-core config.rs:1170-1181] |
| w02-1 | Win | Sol (SOL2) | P2 | real-new (needs Mihomo hang) → PR #787 (codex2/win-switch-cleanup-routing) | #787 OPEN | switch cleanup: sequential 2 s DELETEs with no total bound while holding the lifecycle writer → Disconnect waits minutes if Mihomo hangs [app connection/switch.rs:349-392] |
| w02-2 | Win | Sol (SOL2) | P2 | real-new → PR #787 (codex2/win-switch-cleanup-routing) | #787 OPEN | catalog homeProxy change never applied live; later hot switch derives permits from new routing and drops live H1 permit [catalog_sync.rs:276-306; switch.rs:165-205] |
| w02-3 | Win | Sol (SOL2) | P3 | real (ms-scale race) ; not fixed | - | extra release_explicit after fail_connect can hit a successor attempt [app connection.rs:253-265] |
| w02-4 | Win | Sol (SOL2) | P3 | real (UX); not fixed | - | recovery preflight admits stale selection if user picks another server in 2.5 s window [connection/heal.rs:78-108] |
| w03-1 | macOS | Sol (SOL2) | P2 | real but deliberate documented design (retain PF on cancel); needs decision; not fixed | - | legacy (pre-/helper/upgrade) helper upgrade cancelled after core stop keeps PF blocking [HelperManager.swift:250-267,364-371] |
| w04-1 | macOS | Sol (SOL2) | P2 | real (narrow race window); not fixed | - | catalog update of the switch target during an in-flight switch is skipped; stale B committed [AppState+Catalog.swift:201-219; AppState+Proxy.swift:103-171] |
| w04-2 | macOS | Sol (SOL2) | P3 | real-new → PR #785 (codex2/mac-update-retire-state) | #785 OPEN | verified update Disconnect then retire failure leaves UI armed/blocked [AppState+NativeUpdate.swift:134-143] |
| x01 | CP | Sol (SOL2) | - | – | - | no findings [index.ts 1-683,1016-1756] |
| x02-1 | Win | Sol (SOL2) | P1 | real but deliberate (§3 "keep armed, wait for choice"); conflicts with fail-open rule; needs decision; not fixed | - | selected exit removed from catalog → stop_core(false) keeps WFP Blocked for non-strict users until they pick a node [catalog_sync.rs:245-247,296-299; switch.rs:22-75] |
| x04-1 | macOS | Sol (SOL2) | P3 | real-new → PR #788 (codex2/mac-sidecar-stale-pid) | #788 OPEN | stale legacy tailscaled.pid reused by unrelated process → cloud startup throws every launch [TonoSidecarService.swift:225,312-330] |
| x04-2 | macOS | Sol (SOL2) | P3 | real (cosmetic); not fixed | - | receive failure doesn't mark stream stalled → stale traffic/connection feed shown as live [CoreWebSocket.swift:99-102,182-185,330-353] |
| x03-1 | macOS | Sol (SOL2) | P2 | plausible multi-step race (needs truncated response + overlapping renewals); unconfirmed end-to-end; not fixed | - | concurrent stale-token 401s + truncated retry response → obsolete bearer's 401 treated as decisive refusal → account suspended, Core stopped, PF kept [TonoAPIClient.swift:658-675,788-837] |
| x03-2 | macOS | Sol (SOL2) | P3 | real (UX); not fixed | - | keychain write failure after sign-in: Retry ignores in-memory refresh token → forced re-sign-in [AccountSession+Auth.swift:24,261-281] |

Codex2 round 3 (fixes of the unfixed rows above, opened 17:27-17:28 MT):
- x02-1 → #791 (OPEN)
- n01-1 → #792 (OPEN)
- n02-1 → #793 (OPEN)
- w03-1 → #794 (OPEN)
- s07-2 → #795 (OPEN)

Still queued on codex2: mac-account-token-fixes (x03-1/x03-2), mac-catalog-switch-target (w04-1), ai-direct-suffix-guard (n09-3), win-connection-races (w02-3/w02-4), mac-websocket-stall (x04-2), cp-logout-refresh-race (n05-2), win-installer-retry-candidates (n03a-3).

Sol2 FP rate: 3/45 decided (6.7%).

## C. Prior: Grok bug hunt, cloud agent bc-0a0f053a
| ID | Area | Model | Sev | Verdict | PR (state) | Description |
|---|---|---|---|---|---|---|
| G-766 | C6 | Grok | P2 | fixed | #766 MERGED | concurrent failure-cluster opens hit the unique index → diagnostics upload 500 |
| G-767 | C7b | Grok | P3 | fixed | #767 MERGED | a ledger reversal row kept a positive source amount → CSV total double-counted |
| G-768 | A10 | Grok | P2 | in-PR | #768 OPEN | mihomo WS watchdog loses its attempt token during init → no close or reconnect |
| G-770 | C7a | Grok | P3 | in-PR | #770 OPEN | a colon in a customer email → ops customer-list cursor 500 |
| G-771 | A5 | Grok | P2 | in-PR | #771 OPEN | non-ASCII exit names fold to "" → distinct cities treated as the same exit |
| G-772 | A6 | Grok | P2 | in-PR | #772 OPEN | an update adoption retry auto-reconnects an already rebound successor |

The Grok round-1 reject list (OPS_ROLES default owner, #317, #4/#5, #409, device-action replay, Trojan/VMess/SS admission) is in the transcript. Grok's exact FP rate is unknown: it reported only proven bugs.

## D. Prior: GLM-5.3 (verified 12) and Sol account 1 (verified ~10 new), with the PRs that fix them
| Source | Finding | Area | Sev | PR (state) |
|---|---|---|---|---|
| GLM #1 | Windows startup unwanted-intent cleanup never retries | W1 | P1 | #753 (OPEN) |
| GLM #2 | Windows DNS restore GUID case | W5 | P1 | #754 (OPEN) |
| GLM #3 | macOS repair counter never reset | M6 | P1/P2 | #755 MERGED |
| GLM #4 | activation reconcile default armed=true | M6 | P2 | #755 MERGED / #760 |
| GLM #5 | TUN-missing ticks during switch | M6 | P2 | #755 MERGED / #760 |
| GLM #6 | RuntimeCleanup DNS sweep only with snapshot | M5 | P2 | #756 (OPEN, auto-merge) |
| GLM #7 | unarmed cleanup error overwrite | M6 | P2 | #755 MERGED |
| GLM #8 | emergency disarm aborts on a stale core | M1 | P2 | #763 (OPEN, DIRTY) |
| GLM #9 | helper crash-loop without DNS recovery (deleted user) | M1 | P2 | #763 (OPEN, DIRTY) |
| GLM #10 | WeChat signed-path leg allow-in-place | A3 | P2 | #757 (OPEN) |
| GLM #11 | mark_verified ARMED.lock().unwrap() poison | W1 | P2 | #769 or #753 (verify) |
| GLM #12 | 198.18.0.2-only missing-snapshot check | W5 | P3 | #769 (verify) |
| SOL1 s03-1 | PF placeholder write blocks release | M2 | P1 | #761 (OPEN) |
| SOL1 c229-1 | SIGPIPE in HelperManager.writeAll | M5 | P1 | in #759/#763 family (verify) |
| SOL1 c27 | log stream not restarted on route commit | M12 | P2 | #762 (OPEN) |
| SOL1 c20-1 | revocation reopen stale-owner complete | C2 | P2 | #758 MERGED |
| SOL1 others | see /workspace/sol-bughunt/REPORT.md, "Real bugs Sol found that GLM missed" | – | – | several open glm/* PRs |

Model FP rates (prior): GLM ~59%; SOL1 ~34%; SOL2 ~7%; Grok not measured.
