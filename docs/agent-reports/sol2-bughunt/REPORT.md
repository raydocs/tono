# Sol2 bug hunt — REPORT (GPT-6.1 Sol, Codex CLI, ChatGPT account 2)

Date: Wed 2026-09-30, 15:49–16:55 MT. Operator: executor subagent. All Codex runs used `CODEX_HOME=~/.codex-2`, `-m gpt-6.1-sol`, `model_reasoning_effort=ultra`, `--enable multi_agent_v2`. Up to about 4 scans plus 4 fixes ran in parallel. Scans ran read-only, each in its own detached worktree. Fixes ran with `workspace-write`, each in its own `codex2/<slug>` worktree off origin/main.

## 1. What was scanned (23 chunks; average 328 s per scan)

| Wave | Chunk | Area / files |
|---|---|---|
| 1 (main cbb4f56a, re-generated) | s07_mac_lifecycle | AppDelegate, PhysicalNetworkReachability, KillSwitchService (macOS) |
| | s08_win_killswitch_a | windows_kill_switch.rs 1-1645 |
| | s10_win_wfp | wfp/mod.rs, wfp_model.rs |
| | s11_win_service_mgr | service manager.rs, netmon |
| | n01_win_service_lifecycle | bin/service.rs, maintenance, boot session |
| | n02_win_update_service | update_transaction.rs, core/update.rs (+gate) |
| | n03a_win_installer | bin/install_service.rs |
| | n03b_win_update_apply | update_executor.rs, update_journal.rs, app commands/update.rs |
| | n04_mac_appstate | AppState.swift, ExitHeal.swift |
| | n05_cp_auth | control-plane index.ts 683-1016, auth.ts, oidc.ts, sessions |
| | n06_cp_metering_policy | traffic-policy.ts, product-account.ts, ops/quota.ts, exit-agent |
| | n07_cp_route | control-plane index.ts 1756-3787 |
| | n08_win_connect_config | tono-core config/node/sing_box, encrypted_dns, connection_plan |
| | n09_mac_connect_config | ConfigPipeline + Configuration/* |
| | n10_win_app_quit | feat/window.rs, lib.rs |
| 2 (main 026e747c) | w01_win_direct | app connection/direct.rs |
| | w02_win_conn_flow | connection/stages, switch, reconnect, transaction, controller, failure, heal |
| | w03_mac_proxy_helpermgr | AppState+Proxy, HelperManager, SystemProxy |
| | w04_mac_catalog_update | AppState+Catalog, +NativeUpdate, +Subscriptions, ProtectedDNSProbe, CoreControllerClient |
| 3 (main 026e747c) | x01_cp_index_rest | control-plane index.ts 1-683 + 1016-1756 (no findings) |
| | x02_win_sync_offline | catalog_sync, policy_sync, offline_grant, commands/account.rs |
| | x03_mac_account_api | AccountSession+Auth, TonoAPIClient, ControlPlanePath |
| | x04_mac_verifier_sidecar | ProtectedConnectivityVerifier, TonoSidecarService, CoreWebSocket |

Areas already covered by the earlier GLM hunt (mac helper/PF/DNS, AppState+Connect, WFP kill switch b, Windows DNS, monitor/disconnect/restore) and the other agent's in-flight GLM hunts (mac-lifecycle, win-service) were not rescanned. The new areas were chosen around them.

## 2. Findings (every Sol finding verified by the operator against source)

"Sol sev" is Sol's own rating. "My sev" is after verification, using the severity calibration in the prompt.

| ID | Sol sev | My sev | Platform | Location (main at scan time) | Description | Verdict |
|---|---|---|---|---|---|---|
| s07-1 | P0 | – | macOS | SocketServer.swift:156-160 | SIGTERM exit stops core, leaves PF/DNS | FP: KeepAlive=true restarts helper; new helper releases leftover PF + restores DNS when core stopped (run() :108-116); update bootout deliberately keeps PF |
| s07-2 | P1 | P2 | macOS | RuntimeCleanup.swift:217-231; UpdateRuntime.swift:20-41; SocketServer.swift:108-116 | protectedOffline update: new helper releases PF at start, so commit's observe()==.unprotected ≠ required .protectedOffline → commit throws, update stays pending, Connect blocked (network open) | real-new (not fixed: update-contract change) |
| s08-1 | P0 | P1 | Win | wfp persistent filters; service crash | service crash kills core, persistent WFP blocks until restart | in PR #740 (release restored wanted intent when core not running/proven) |
| s10-1/s11-2 | P0 | P1 | Win | windows_kill_switch.rs:2963-2983, 3035-3063 | App crash/hang → committed DIRECT lease expires → Blocked forever (watchdog verifies Blocked as healthy) | real-new → PR #777 (codex2/win-direct-fail-open) |
| s11-1 | P0 | P1 | Win | manager.rs:736-740; windows_kill_switch.rs:1867-1930, 2321-2337 | intent write failure after live Blocked aborts stop_core/Disconnect/Release → offline until disk fixed | real-new → PR #777 (codex2/win-direct-fail-open) |
| n01-1 | P0 | P2 | Win | service.rs:441-460; server/mod.rs:448-457 | SCM Stop with session: stop_core leaves Blocked WFP + DNS | real-new, design (not fixed; interacts with update/installer stop flows; reboot case in #740) |
| n01-2 | P0 | P2 | Win | service.rs:683-686; windows_kill_switch.rs:2951-2957 | single relock attempt after same-boot restart; flag cleared first | in PR #740 (30 s core-proof window releases when tunnel permit not rendered) |
| n01-3 | P1 | – | Win | service.rs:398-470 | runtime drop waits for hung DNS worker after Stopped | FP: owner guard dropped before Stopped; successor terminates stale owner (owner.rs:78-83); no user impact |
| n02-1 | P0 | P2 | Win | core/update.rs:455-469 | update Prepare DNS-restore failure after core stop keeps bootstrap WFP | real-new but deliberate ("evidence and protection retained"; update Disconnect releases) – not fixed |
| n02-2 | P2 | P3 | Win | core/update.rs:976-986 | retire_recovery_task hardcodes C:\Windows\System32\schtasks.exe; registration uses system dir | real-new → PR #776 (codex2/win-installer-hangs) |
| n03a-1 | P1 | P2 | Win | install_service.rs:1972 | Runtime::new().block_on(manual_gate) drop waits on hung WFP blocking task → installer hangs holding repair gate | real-new → PR #776 (codex2/win-installer-hangs) |
| n03a-2 | P1 | – | Win | install_service.rs:2042-2056 | service-only repair overwrites predecessor before proving replacement | unconfirmed/design (needs app-control rejection or crashing build); not fixed |
| n03a-3 | P2 | P3 | Win | install_service.rs:1352-1354; installer.nsi:815-860 | rollback deletes .next candidates, NSIS auto-retry then always fails | real-new, not fixed (installer UX only) |
| n03a-4 | P2 | P3 | Win | install_service.rs:2050-2062 | RebootRequired path checks strict protocol readiness of old service → exit≠3010 | real-new → PR #776 (codex2/win-installer-hangs) |
| n03b-1 | P0 | P1 | Win | app commands/update.rs:180-229 | Prepare failure before core stop leaves Connected with monitor+DIRECT heartbeat aborted → lease expiry → Blocked | real-new → PR #779 (codex2/win-update-failure-supervision) |
| n03b-2 | P0 | – | Win | update_executor.rs:399-401,514-529 | Runtime::new / SCM recovery config failure after service stop | FP (theoretical failure of Runtime::new/ChangeServiceConfig2) |
| n03b-3 | P0 | P3 | Win | update_executor.rs:331-335,498-538 | executor crash while successor CREATE_SUSPENDED | real but double failure; not fixed |
| n03b-4 | P0 | P2 | Win | update_executor.rs:345-350,507-540 | target service fails to start → no fail-open actor | unconfirmed design gap (needs broken release); not fixed |
| n03b-5 | P2 | P3 | Win | app commands/update.rs:221-228 | snapshot read failure skips Connecting fold → stuck Connecting | real-new → PR #779 (codex2/win-update-failure-supervision) |
| n05-1 | P0 | P2 | CP | oidc.ts:238-245; index.ts:887-967 | Google email_verified on non-Google domain links to existing email account (reassigned mailbox) | real-new, latent (Google sign-in disabled in checked-in config); not fixed |
| n05-2 | P2 | P3 | CP | index.ts:2450-2466; sessions.ts:32-40 | logout vs concurrent refresh race leaves successor session live | real (narrow race); not fixed |
| n04-1 | P0 | P1 | macOS | AppState.swift:1833-1907 | optional-policy (managed DIRECT overlay) apply failure → disconnect(releaseKillSwitch:false): working core stopped, PF bootstrap-only, DNS dead until reconnect/watchdog | real-new → PR #778 (codex2/mac-optional-policy-fail-open) |
| n06-1 | P1 | P2 | exit-agent | reconcile_and_report.py:1733-1746 | ACK failure before saving installedClients loses newly installed client; later revocation never removes it (no-listing xray) | real-new → PR #780 (codex2/metering-undercount) |
| n06-2 | P1 | P1 | exit-agent | reconcile_and_report.py:1099-1128 | after xray restart, absent labels keep stale raw baseline → permanent undercount | real-new → PR #780 (codex2/metering-undercount) |
| n06-3 | P1 | P2 | CP | ops/quota.ts:307-320 | expired-cycle rollover drops traffic since last sample | real-new → PR #780 (codex2/metering-undercount) |
| n06-4 | P1 | P3 | CP | ops/quota.ts:205-215 | reboot reset undetected when counter regrows past prev before next roll | known: issue #5 (counter generation needed); not fixed |
| n07-1 | P0 | – | CP | index.ts:944-966 | = n05-1 (duplicate) | dup of n05-1 |
| n07-2 | P1 | – | exit-agent | reconcile_and_report.py:1122-1127 | = n06-2 (duplicate) | dup of n06-2 |
| n07-3 | P2 | P3 | CP | index.ts:3493-3580 | retained v1 report replayed after a source counter reset re-bills history (v1 higher-total exception) | real (legacy protocol v1 only; current agent sends v2); not fixed |
| n08-1 | P0 | P2 | Win | app connection/endpoints.rs:21-40; stages.rs:60-72 | home endpoint dedup by IP:port only drops home TCP permit when HY2 sibling selected | real-new → PR #783 (codex2/win-hy2-routing) |
| n08-2 | P1 | P2 | Win | tono-core config.rs:1052-1084,1187-1194 | HY2 exit: no UDP REJECT, home rules TCP-only → assistant QUIC leaves via cloud exit, not residential | real-new → PR #783 (codex2/win-hy2-routing) |
| n08-3 | P1 | P2 | Win | app connection/switch.rs:139-281 | hot switch VLESS↔HY2 keeps old UDP rule (no runtime rebuild) | real-new → PR #783 (codex2/win-hy2-routing) |
| n09-1 | P1 | P2 | macOS | AppState+Catalog.swift:199-222,233-260 | homeProxy node params rotated under same name → no reload, stale residential route | real-new → PR #781 (codex2/mac-home-proxy-reload) |
| n09-2 | P1 | P3 | macOS | ConfigPipeline+SingBoxProduct.swift:160-210 | real-IP DNS answers (hosts/China DNS) lose hostname; no sniff/reverse mapping → web-direct rules miss | unconfirmed (sing-box semantics; sing-box product path is default-off); not fixed |
| n09-3 | P2 | P3 | macOS/CP | ConfigPipeline+Direct.swift:9-25; traffic-policy.ts:218 | protected-from-direct suffix list omits OpenAI/other assistants; a signed policy could route them direct | real (defense-in-depth; needs a signed bad policy); not fixed |
| n10-1 | P0 | – | Win | windows_kill_switch.rs:3035-3067 | = s10-1 (duplicate) | dup of s10-1 |
| n10-2 | P1 | P2 | Win | app commands/quit.rs:274-300; feat/window.rs:470-520 | quit before protection discovery skips Service release; app exits leaving core/WFP/DNS | real-new → PR #784 (codex2/win-quit-fixes) |
| n10-3 | P2 | P3 | Win | app commands/quit.rs:278-281,313-336 | cancelled quit never restarts catalog/policy sync | real-new → PR #784 (codex2/win-quit-fixes) |
| w01-1 | P0 | P1 | Win | app connection/direct.rs:62-64; policy_sync.rs:82-107 | same-content policy revision changes raw digest → DIRECT heartbeat exits silently → lease expires → healthy session Blocked | real-new → PR #786 (codex2/win-direct-heartbeat-policy) |
| w01-2 | P0 | P1 | Win | app connection/direct.rs:495-503,825; tono-core config.rs:1170-1181 | plan with suffix rows but no emitted controller rules passes empty check → bracket opens → empty-graph proof fails → Blocked/reconnect loop | real-new (trigger depends on policy/pins) → PR #786 (codex2/win-direct-heartbeat-policy) |
| w02-1 | P0 | P2 | Win | app connection/switch.rs:349-392 | switch cleanup: sequential 2 s DELETEs with no total bound while holding the lifecycle writer → Disconnect waits minutes if Mihomo hangs | real-new (needs Mihomo hang) → PR #787 (codex2/win-switch-cleanup-routing) |
| w02-2 | P0 | P2 | Win | catalog_sync.rs:276-306; switch.rs:165-205 | catalog homeProxy change never applied live; later hot switch derives permits from new routing and drops live H1 permit | real-new → PR #787 (codex2/win-switch-cleanup-routing) |
| w02-3 | P2 | P3 | Win | app connection.rs:253-265 | extra release_explicit after fail_connect can hit a successor attempt | real (ms-scale race) ; not fixed |
| w02-4 | P2 | P3 | Win | connection/heal.rs:78-108 | recovery preflight admits stale selection if user picks another server in 2.5 s window | real (UX); not fixed |
| w03-1 | P0 | P2 | macOS | HelperManager.swift:250-267,364-371 | legacy (pre-/helper/upgrade) helper upgrade cancelled after core stop keeps PF blocking | real but deliberate documented design (retain PF on cancel); needs decision; not fixed |
| w04-1 | P0 | P2 | macOS | AppState+Catalog.swift:201-219; AppState+Proxy.swift:103-171 | catalog update of the switch target during an in-flight switch is skipped; stale B committed | real (narrow race window); not fixed |
| w04-2 | P2 | P3 | macOS | AppState+NativeUpdate.swift:134-143 | verified update Disconnect then retire failure leaves UI armed/blocked | real-new → PR #785 (codex2/mac-update-retire-state) |
| x01 | – | – | CP | index.ts 1-683,1016-1756 | no findings | – |
| x02-1 | P0 | P1 | Win | catalog_sync.rs:245-247,296-299; switch.rs:22-75 | selected exit removed from catalog → stop_core(false) keeps WFP Blocked for non-strict users until they pick a node | real but deliberate (§3 "keep armed, wait for choice"); conflicts with fail-open rule; needs decision; not fixed |
| x04-1 | P2 | P3 | macOS | TonoSidecarService.swift:225,312-330 | stale legacy tailscaled.pid reused by unrelated process → cloud startup throws every launch | real-new → PR #788 (codex2/mac-sidecar-stale-pid) |
| x04-2 | P2 | P3 | macOS | CoreWebSocket.swift:99-102,182-185,330-353 | receive failure doesn't mark stream stalled → stale traffic/connection feed shown as live | real (cosmetic); not fixed |
| x03-1 | P0 | P2 | macOS | TonoAPIClient.swift:658-675,788-837 | concurrent stale-token 401s + truncated retry response → obsolete bearer's 401 treated as decisive refusal → account suspended, Core stopped, PF kept | plausible multi-step race (needs truncated response + overlapping renewals); unconfirmed end-to-end; not fixed |
| x03-2 | P2 | P3 | macOS | AccountSession+Auth.swift:24,261-281 | keychain write failure after sign-in: Retry ignores in-memory refresh token → forced re-sign-in | real (UX); not fixed |

## 3. Sol accuracy

- Raw findings: **53** (s10-1/s11-2 are one row). **4 duplicates** (s11-2, n07-1, n07-2, n10-1, the lease bug being found 3 times), leaving **49 unique**.
- **False positives: 3** (s07-1, n01-3, n03b-2). **Unconfirmed/plausible: 4** (n03a-2, n03b-4, n09-2, x03-1). **Already known/in flight: 3** (s08-1 and n01-2 → #740; n06-4 → issue #5).
- **Real and new: 39**. 4 of these are real but deliberate or documented designs that conflict with the fail-open rule (n01-1, n02-1, w03-1, x02-1) and need a product decision.
- **FP rate: 3/45 = 6.7%** of decided findings, or 7/49 = 14% if every unconfirmed one is counted as a FP.
- **Severity inflation is Sol's main weakness.** Sol rated 22 findings P0; after verification there are **0 P0**, 9 P1, 19 P2 and 17 P3. Sol's P0 usually meant "can cut the network in some path", but most paths need a second failure, a policy/catalog edge case, or a hang.
- Location quality was excellent: every file:line pointed at the real code, and most findings came with a correct root cause and a sensible fix direction.

## 4. PRs (all by this hunt; all have auto-merge (merge commit) enabled; the `ci-gate` ruleset is strict, so a background keeper (`fix/keeper.sh`, every 10 min, up to ~8 h) merges main into a BEHIND PR only when none of its checks are pending or failing)

| PR | Branch | Fixes | Network → `needs-hardware` | State at 16:55 MT |
|---|---|---|---|---|
| #776 | codex2/win-installer-hangs | n03a-1, n02-2, n03a-4 | no (installer/recovery task) | open, CI green, re-synced with main |
| #777 | codex2/win-direct-fail-open | s10-1/s11-2/n10-1, s11-1 | **yes** | open, CI green, re-synced with main |
| #778 | codex2/mac-optional-policy-fail-open | n04-1 (narrowed by operator) | **yes** | open, CI running |
| #779 | codex2/win-update-failure-supervision | n03b-1, n03b-5 | **yes** | open, CI green, re-synced with main |
| #780 | codex2/metering-undercount | n06-1, n06-2, n06-3 | no | **MERGED** (after an ops-budget trim of quota.ts to 500 lines) |
| #781 | codex2/mac-home-proxy-reload | n09-1 | **yes** | open, CI green, BEHIND → keeper |
| #783 | codex2/win-hy2-routing | n08-1, n08-2, n08-3 | **yes** | open, CI running |
| #784 | codex2/win-quit-fixes | n10-2, n10-3 (narrowed by operator) | **yes** | open, CI green, BEHIND → keeper |
| #785 | codex2/mac-update-retire-state | w04-2 | no (UI state only) | open, CI running |
| #786 | codex2/win-direct-heartbeat-policy | w01-1, w01-2 | **yes** | open, CI running |
| #787 | codex2/win-switch-cleanup-routing | w02-1, w02-2 | **yes** | open, CI running |
| #788 | codex2/mac-sidecar-stale-pid | x04-1 | no | open, CI running |

Every PR contains `docs/changelog.d` + `docs/findings.d` records, linked to the PR number. None of them edit DECISIONS.md or change the macOS helper (no helper version bump needed). None push to main or touch other agents' PRs, #691/#694, `/workspace/tono-codex` or `/workspace/glm-fix/wt-*`. The operator changed Sol's diffs in three places:
- **#778:** reverted Sol's switch of the post-replacement branch to a full release without reconnect, keeping the fix minimal.
- **#784:** limited the quit-time Service fallback to this user's active session, because the kill-switch aggregate is machine-wide.
- **#780:** fixed the ops line budget.

## 5. Not fixed; these need a decision or are low value
- **Product decisions (real, conflict with fail-open):**
  - n01-1: SCM Stop leaves Blocked WFP + DNS.
  - n02-1: update Prepare DNS-restore failure keeps bootstrap WFP.
  - x02-1: a vanished catalog exit keeps a non-strict user Blocked until they pick a node (spec §3).
  - w03-1: cancelling a legacy macOS helper upgrade keeps PF.
- **s07-2 (P2):** the macOS protectedOffline update commit can never pass once the new helper releases PF at launch (needs an update-contract change).
- **n05-1 (P2, latent):** Google `email_verified` on a non-Google domain auto-links to an existing account. Google sign-in is currently disabled; fix before enabling it.
- **Also not fixed, with reasons in the table:**
  - P2: x03-1, w04-1.
  - P3: n03a-3, n03b-3, n05-2, n07-3, n09-3, w02-3, w02-4, x03-2, x04-2.

## 6. Quota (account 2, plan "prolite")
- `rate_limits` shows only a weekly primary window (10080 min). There is no 5-hour window and the secondary is null. The weekly window **resets Wed 2026-10-07 15:49 MT**.
- Usage: 0% at 15:49 → 8% at 16:11 → 14% at 16:29 → **16% at 16:49–16:55 MT** (last reading).
- **Burn rate:** about **17%/hour** averaged over the first hour, with peaks of about 25%/hour at 8–9 concurrent ultra runs (4 scans + 4–5 fixes) and 0% when idle. At the observed rate one scan chunk costs about 0.6–0.8% and one fix run about 0.8–1%.
- The ≥95% guard (`guard.py`) was active the whole time and was never triggered; it was stopped at the end because nothing is running now.
- Artifacts:
  - Scans: `raw/*.md|jsonl`, `raw/timing.log`, `raw/quota.log`.
  - Fixes: `fix/runs/<slug>/{final.md,diff.patch}`, `fix/runs/ledger.log`.
  - PRs: `fix/prbodies/`, `fix/prs.log`, `fix/keeper.log`.

---

# Round 3: fixing the remaining real findings (2026-09-30, 17:00–18:30 MT)

**User decision (2026-09-30):** keep using Codex account 2 (`CODEX_HOME=~/.codex-2`, `gpt-6.1-sol`, effort `ultra`) to fix what's left.
- **Top rule:** tono must never cut users' network or crash their machines. On crash, hang, stop or a failed update, it falls back to normal internet access while AI services stay blocked.
- **Workflow:** one `codex2/<slug>` worktree off the latest origin/main per fix, operator review and trim, one themed PR each. Network PRs get `needs-hardware`. Auto-merge is set to merge commit.
- **Budget:** the 45% stop was later lifted by the user.

**AI-layer note:** keeping AI blocked after a fail-open is open PR #738, which hooks the standard release paths. Every fail-open fix below goes through those existing standard release paths. None adds its own blocking layer, and none weakens AI blocking in normal operation, so none of the four "design" findings had to be left alone.

## New PRs
| PR | Branch `codex2/…` | Fixes | hw | Operator changes |
|---|---|---|---|---|
| #791 | win-catalog-exit-removed-release | x02-1 | yes | – |
| #792 | win-scm-stop-fail-open | n01-1 | yes | Shared `strict_kill_switch_enabled()` hunk made identical to #793's; const ordering |
| #793 | win-update-prepare-fail-open | n02-1 | yes | Same shared hunk as #792 |
| #794 | mac-helper-upgrade-cancel-release | w03-1 | yes | – |
| #795 | mac-update-offline-commit | s07-2 | yes | Helper bumped to 4.52.8 (main 4.52.7), CONTRACT.sha256 regenerated |
| #796 | mac-account-token-fixes | x03-1, x03-2 | no | Dropped Sol's CancellationError on the no-token/no-renewal path |
| #797 | ai-direct-suffix-guard | n09-3 (macOS, Windows, control plane) | yes | Explicit protected lists restored (cross-platform signing contract); assistant home list added as a separate guard. CP 950/950, contract 5/5, tono-core policy 19/19 |
| #798 | win-connection-races | w02-3, w02-4 | yes | – |
| #799 | mac-websocket-stall | x04-2 | no | – |
| #800 | cp-logout-refresh-race | n05-2 | no | Test uses a second installation (429); CP 950/950 |
| #801 | win-installer-retry-candidates | n03a-3 | no | Packaging source check now counts `cleanup_with_staged_retained` (windows/app CI failure fixed) |
| #802 | mac-catalog-switch-target | w04-1 | yes | Rejected the first version (it disconnected); resumed Sol for a queued-reload approach |
| #858 | win-update-suspended-successor | n03b-3, n03b-4 | yes | Strict accessor renamed `strict_kill_switch_intent_on_disk()` so it can't collide with #792/#793. Cross `cargo check --target x86_64-pc-windows-gnu` passes |

No `Fixes #N`: none of these findings had a matching issue. #795 is the only PR that touches the macOS helper. Other open helper PRs (#773, #763, #765, #761, #691) may collide on the version later; the merge manager's `bumphelper.sh` handles that.

**Merging:** a separate merge manager (`/workspace/merge-work`, other agent) now serializes merges. It keeps auto-merge on for at most N queued PRs and turns it off on all others within about 20 s. All of these PRs are in its queue, so "auto-merge off" on them is expected.

## Issues filed (not fixed)
- **#789 (n05-1):** Google `email_verified` without `hd` auto-links to an existing account. Filed as instructed; Google sign-in is currently disabled.
- **#815 (n03a-2):** Windows service-only repair overwrites the predecessor before proving the replacement starts. Unconfirmed design gap; needs an app-control rejection or a crashing build.
- **#816 (n07-3):** a legacy v1 named-source replay after a counter reset re-bills history. Real, but v1-only; the fix needs per-report applied tracking (schema).
- **#817 (n09-2):** on the macOS sing-box product path, real-IP DNS answers lose the hostname needed by web-direct rules. Unconfirmed: depends on sing-box semantics, and the path is off by default.
- **n06-4:** already tracked in #5 (needs a counter generation).
- **False positives, no issue:** s07-1, n01-3, n03b-2.

## Quota (account 2)
- 16% before round 3 → 21% after 12 fix runs and 1 resume → **33% at 18:28 MT**. Part of that is the other account-2 job (wave-1 hunt and fix); this round added 1 fix run and 1 resume.
- The weekly window resets Wed 2026-10-07 15:49 MT.
