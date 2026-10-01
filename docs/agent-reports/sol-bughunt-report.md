# GPT-6.1 Sol (Codex CLI) bug-hunt benchmark on raydocs/tono: same test as GLM-5.3 (read-only)

**Status: PARTIAL. 9 of 13 scan chunks done, calibration done.** I stopped early because the ChatGPT Codex 5-hour limit reached 98% (it resets at 19:10 MT).
- **Done:** calib ×4; scan chunks s01, s02, s03, s04, s05, s06, s09, s12, s13.
- **Not done:** s07_mac_lifecycle, s08_win_killswitch_a, s10_win_wfp, s11_win_service_mgr.
  - s07 started at 14:40, but the box restarted at about 14:48 and killed it before it produced a final answer. Its partial trace is in `raw/s07_mac_lifecycle.jsonl`.
  - s08, s10 and s11 were never started.

Nothing was pushed, commented on or opened on GitHub. `/workspace/tono-codex` was not touched.

## Setup
- **Repo:** my own clone `/workspace/sol-bughunt/repo`, detached at `ba7c8ae1` (the same commit GLM reviewed). The push URL is disabled. There are no PR refs in the clone, so Sol could not see the fixes.
- **Model and runner:** Codex CLI 0.159.2, logged in with ChatGPT (Team plan). Model id `gpt-6.1-sol`, `-c model_reasoning_effort=xhigh`. The CLI offers low, medium, high, xhigh, max and ultra.
- **Command** (runner `sol.sh`):
  `codex exec -m gpt-6.1-sol -c model_reasoning_effort=xhigh -c project_doc_max_bytes=0 -s read-only -C repo --json -o raw/NAME.md - < prompts/NAME.txt`
  - `project_doc_max_bytes=0` stops the repo's AGENTS.md from being injected. AGENTS.md tells agents to merge and deploy, and GLM never saw it either.
  - The read-only sandbox has no network and no writes.
- **Prompts:** exactly GLM's prompt files (`/workspace/glm-bughunt/prompts/*.txt`: the same instructions and the same line-numbered chunks). One read-only harness note was prepended (`preamble.txt`) saying Sol may read the repo but must not edit it. The final prompts are in `prompts/`.
- **Advantage over GLM:** Sol ran as an agent and read surrounding code on its own. It ran 20–60 rg/sed commands per run and often cited callers outside the chunk. Several findings depend on that cross-file reading. GLM saw only the chunk.
- **Raw output:** `raw/NAME.md` is the final answer and `raw/NAME.jsonl` is the event stream.
  - The jsonl streams for s02, s04 and s05 were truncated by a runner-script bug: I edited the script while it was running.
  - For s04 and s05, the jsonl was restored from `raw/jsonl_backup/`. s02's was lost.
  - Per-run token usage for all runs was recovered from the Codex session logs into `raw/usage_from_sessions.json`.

## Step 1: calibration — Sol 2/4 (GLM also 2/4, but a different pair)

| Bug | Sol | GLM |
|---|---|---|
| #20 `last_attempt_at` not reset on ON CONFLICT enqueue (control-plane `index.ts`) | **MISSED** | MISSED |
| #229 `try?` on `/helper/upgrade` → ~45 s stall (`HelperManager.swift:1167`) | **MISSED** (found other issues in the file) | FOUND |
| #27 log stream not restarted on route change | **FOUND** (calib_27 #3): "only the connections stream is restarted at commit; invalidate the logs receive task too", with the false `managed_direct_group_failed_over` consequence | MISSED |
| #139 `VITE_OPS_ROLE` baked in at build time | **FOUND** (calib_139 #3) | FOUND |

**Other calibration findings: 11 in total, 8 real (1 of them covered by open PR #716), 3 FP, so about 27% FP.** GLM had 15 extras, about 47% FP.

Real:
- c20-1 (P2 race, narrow):
  - `index.ts:1663`: the stale owner check in `processRevocations` can mark a just-reopened revocation job complete.
  - Sequence: the drain reads an active owner → a concurrent revoke upsert reopens the same job, with the same id and generation → the drain's "skipped" UPDATE completes it and the node is never deleted.
- c20-3 (P2): `index.ts:1138/1247`: pending and reopened devices don't refresh `last_seen_at`, so LRU eviction picks them too early. GLM also found this.
- c229-1 (P1): `HelperManager.swift:1362` `writeAll`: there is no `SO_NOSIGPIPE`, and the app does not ignore SIGPIPE, so if the helper closes the socket, SIGPIPE kills the app.
- c229-3 (P2): `HelperManager.swift:1233`: `helperBoundAccount` returns "UID n" for a deleted account and refuses the install. The root-side guard explicitly allows rebinding in that case.
- c27-2 (P2): `CoreWebSocket.swift:99/182`: receive failures never call `markStreamStalled`, and each reconnect resets the watchdog deadline, so a dead core's stale traffic and connections keep showing as live.
- c139-1: shared-admin handlers bypass the role check (`index.ts:2922`). **Covered by open PR #716.**
- c139-2 (P2): the ops console refresh "beat" is never passed to the detail pages or the incident drawer (`App.tsx:134`, `NodeDetail.tsx:50-55`, `CustomerDetail.tsx:75-91`, `IncidentDrawer.tsx:58`), which contradicts the "every read hangs off this beat" comment at App.tsx:40-48.
- c139-4 (P2):
  - The source pill freshness uses `newestFetch` over all resources (`App.tsx:125`, `Shell.tsx:82/128`).
  - `useResource` keeps the last health data on error, so a failing `system/health` read keeps showing a green verdict with a fresh timestamp.

FP:
- c20-2: pausing enrollment stops revocations. This is documented and deliberate (`index.ts:1636`).
- c229-2: a matching helper version hides a broken core. Theoretical: it needs a crash between two renames.
- c27-1: buffered logs inherit a later upload consent. The window is 250 ms, so negligible.

## Step 2/3: scan results (9 chunks)

### Totals

| | Sol, 9 chunks | GLM, same 9 chunks | GLM, all 13 |
|---|---|---|---|
| Findings | 29 | 30 | 41 |
| Real, new (not GLM, not in an open PR) | **12** (10 unique; the placeholder bug was reported 3×) | n/a (GLM's own verified: 10) | 12 |
| Real, covered by open PR | 3 | 2 | 5 |
| Already found by GLM | 2 | – | – |
| Unconfirmed (platform- or design-dependent) | 2 | – | – |
| Rejected (FP / theoretical / deliberate) | 10 | 18 | 24 |
| FP rate | **34%** (41% if unconfirmed counts as FP) | 60% | 59% |

In the same 9 chunks, GLM's 10 verified bugs and Sol's 10 unique new bugs overlap on only 2 bugs. The two models find largely different bugs.

Sol repeated two themes across chunks:
- **The PF placeholder-write bug:** reported in s01, s02 and s03.
- **"Hung core + dead GUI never fails open":** reported in s01, s03 and s04. I rejected it as a double-failure design gap rather than a concrete bug. The concrete single-failure variant is s05-1, which I accepted.

Sol's severities are inflated: almost everything is labelled P0. The P-levels below are mine.

### Real bugs Sol found that GLM missed (for the fixer)

1. **P1 — macOS PF release is blocked by a failed placeholder write** (s03-1; also s01-4 and s02-1).
   - **Location:** `tooling/scripts/core-helper/KillSwitchManager.swift:614-624` (`releaseSequence` runs `try writePlaceholder()` before `flushAnchor`). Callers at `:566-580` and `:586-608`.
   - **Scenario:** the disk is full or `/Library/Application Support/Tono` can't be written → `atomicWrite` throws → the anchor is never flushed. This affects every release path: disarm, watchdog, startup release, failure release and `--emergency-disarm`.
   - **Also:** `SocketServer.swift:190-202` returns before `recoverDNSAfterStoppedCore()`, so DNS also stays on 127.0.0.1.
   - **Why it's a bug:** this is the same class of bug the code already fixed for /etc/hosts (BRICK-M2 comment at :637-641).
   - **Fix:** make the placeholder write best-effort, or do it after a verified flush. Always attempt `pfctl -a … -F all`, and run DNS recovery even when the PF release throws. Update the ordering test at `KillSwitchTests.swift:757-773`.
   - **Coverage:** no open PR covers it.

2. **P1 — macOS: an app crash mid-connect leaves PF blocking indefinitely while the core runs** (s05-1).
   - **Location:** `apps/macos/Tono/Services/AppState+Connect.swift:297-321` (first arm with `tunnelInterfaces: []`) through `:352-377` (second arm that permits utun199); `tooling/scripts/core-helper/SocketServer.swift:168-177` (the watchdog resets its counter while `core.status().running`).
   - **Scenario:** the app crashes or hangs after `/core/start` and before the lock arm.
   - **Result:** the core stays alive, PF allows no tunnel, and the helper never fails open. Recovery happens only when the app is relaunched.
   - **Coverage:** PR #720 explicitly states "A crash mid-attempt still does not disarm by itself".
   - **Fix:** give the helper a connect-transaction lease or GUI heartbeat. If it expires before the lock arm commits, stop the core, restore DNS and disarm, unless the session is strict.

3. **P1 — macOS: a connected session can show Protected while PF is gone** (s06-2).
   - **Location:** `AppState+Connect.swift:1524` (the health check requires `health.wanted`), `:1823-1843` (the `tun_route_rearm` failure is only logged); `KillSwitchService.swift:156-178` (`isArmed` is never cleared on a confirmed-unarmed status); `KillSwitchManager.swift:373-380` (a failed arm releases the block and deletes the intent).
   - **Scenario:**
     1. The monitor's re-arm fails.
     2. The helper fails open, so wanted=false and live=false.
     3. The app keeps `isArmed=true`, stays Connected, and ignores wanted=false forever.
   - **Fix:**
     - Treat wanted=false during a protected session as a released barrier.
     - Clear `isArmed` when an authenticated status confirms neither armed nor wanted.
   - **Related:** the same root cause, in the connect-failure path, is s05-2, which #720 covers.

4. **P2 — macOS: a partial PF repair loses the `repairedSinceArm` notification** (s03-3).
   - **Location:** `KillSwitchManager.swift:759-775` (`superviseProtection`); `KillSwitchPF.swift:668-709` (`ensureAnchorLoaded` can throw after it has loaded the rules, taken the reference and flushed states, i.e. at the final `effectiveStatus()` check or in `holdPFEnableReference`).
   - **Scenario:** the repair reinstalls the persisted rules, which have no session direct exceptions, and then the verification throws. The catch returns without setting `repairedSinceArm`. The next pass sees live and referenced, so the app is never told to re-arm, and direct-route traffic is silently dropped. `status()` has the same lost-flag path at :677-701.
   - **Fix:** set a "needs reassert" flag before any rule load that can replace kernel rules, and clear it only on a committed arm.

5. **P2 — macOS: more than 8 original DNS servers produce a snapshot that restore rejects** (s04-3).
   - **Location:** `tooling/scripts/core-helper/ProtectedDNSManager.swift:129-144` (enable saves `existingServers` read via the SC path `dnsServers` at :919-927, which has no count limit); `save()` at :637-641 has no count check; `loadSnapshot` at :630 requires `servers.count <= 8`. The enable rollback via `writeDNS` (:767) also rejects more than 8.
   - **Result:** restore quarantines the snapshot, and the user's DNS is not restored.
   - **Fix:** validate the same way at read, save and load. Refuse to enable, or support the full list.

6. **P2 — macOS: the browser Secure-DNS audit uses a fail-closed teardown** (s06-1).
   - **Location:** `AppState+Connect.swift:1552-1572`.
   - **Scenario:** a residential-configured user enables Chrome or Edge Secure DNS → `disconnect(releaseKillSwitch: false)`. The core stops, DNS is not restored, and PF drops to bootstrap-only.
   - **Result:** about 30 s with no network, until the helper's core-down watchdog releases it. No reconnect is scheduled.
   - **Policy:** this conflicts with the fail-open rule. PR #720 explicitly left the browser-DoH branch unchanged.
   - **Fix:** use the shared exhausted-failure release (`releaseKillSwitch: true` when not strict).

7. **P2 — Windows: a failed StartClash can leave WFP blocking while the app shows Not Connected** (s12-1).
   - **Location:** `apps/windows/service/src/core/server/handlers.rs:666-701` (StartClash arms WFP bootstrap and then returns an error from `owner_proxy_transition` without releasing it).
   - **App side:**
     - `apps/windows/app/src-tauri/src/tono/connection.rs:592-640`: when the status read also fails, `armed` falls back to the FSM latch, which is false. The path then calls session-gated `tono_stop_core`, which fails because there is no session, and the error is ignored.
     - `disconnect.rs:339-343`: Disconnect is then a no-op.
     - `monitor.rs:564-571`: the resync poll is not registered, because it only runs in Protected Offline.
   - **Trigger:** StartClash fails and the follow-up status read also fails, so it's narrow.
   - **Fix:** treat a failed mutating StartClash as possibly armed. Run the owner-gated release without a session, or have the Service roll back its bootstrap arm on StartClash failure.

8. **P2 — Windows: a tombstone write failure reinstalls the block after a successful release** (s09-2).
   - **Location:** `apps/windows/service/src/core/windows_kill_switch.rs:2432-2449`. When `persist_disarmed_tombstone` fails, it rewrites the wanted intent and `install_unlocked(&previous)`.
   - **Scenario:** a persistent ACL or disk error means every Disconnect re-blocks.
   - **Deliberate?** Yes, documented, but it conflicts with the fail-open rule.
   - **Fix:** keep WFP released and retry the durable record separately. Make sure an older wanted intent cannot win at the next start.

9. **P2 — Windows: a DNS snapshot delete failure prevents WFP release after a proven restore** (s09-3).
   - **Location:** `apps/windows/service/src/core/dns/mod.rs:2792-2795` (`remove_file` error → `Err`); `windows_kill_switch.rs:2427` (`bounded_dns_call("disarm", …)?`).
   - **Trigger:** plausible as a transient AV sharing violation.
   - **Fix:** once restore is proven, don't fail the disarm on snapshot housekeeping. Retry the delete later.

10. **P2 (hardening, needs a malicious same-user process) — macOS helper: a FIFO swapped in for config.json hangs the helper loop** (s01-3).
    - **Location:** `tooling/scripts/core-helper/main.swift:1281` does a blocking `open(source, O_RDONLY|O_CLOEXEC|O_NOFOLLOW)` before the `fstat` type check at :1297.
    - **Result:** the single-threaded server loop and the watchdog stop, so PF stays armed.
    - **Fix:** add `O_NONBLOCK` (then clear it) and reject non-regular files before reading.

### Real, covered by open PRs
- s04-4: `ProtectedDNSManager.swift:323-338, 456-483`. The restore sweep clears a loopback resolver that isn't Tono's. **#712.**
- s05-2: `AppState+Connect.swift:639-643` / `KillSwitchService.swift:164-171`. A stale `isArmed` re-arms bootstrap PF after the helper failed open. **#720.**
- s12-2: `monitor.rs:1239-1247, 1274-1287`. Health-monitor recovery keeps WFP blocking. **#715** (and #703).

### Already found by GLM
- s01-2 = GLM #9: helper startup failure with a deleted bound user skips DNS recovery.
- s13-3 = GLM #2: GUID case-sensitive comparisons in the Windows DNS restore proof.

### Unconfirmed
- s13-1: `dns/mod.rs:1074-1087` / `engine.rs:1256-1312`.
  - The "live" loopback proof (`any_loopback` → `read_adapter`) reads the registry values that `apply_snapshot` has just rewritten.
  - So after a failed live apply, the restore is "proven" without independent evidence, and the 3-failure degraded exit is effectively bypassed.
  - Whether this matters depends on whether Dnscache follows registry writes without a live apply. The code's own comment claims it does.
  - Worth a look by someone with a Windows box.
- s09-1: `windows_kill_switch.rs:2972-2980`. When the app dies, the DIRECT lease expires and the watchdog moves to Blocked (the tunnel permit is cleared).
  - The mechanics are as described, and this is a design conflict with the fail-open rule.
  - I did not confirm that normal sessions always hold a lease. The overall Windows fail-open policy is being reworked in #733/#740.

### Rejected (one-line reasons)

"Hung core with the GUI gone never fails open" (s01-1, s03-2, s04-1): a double-failure design gap, i.e. hardening rather than a concrete bug. s05-1 is the concrete variant.

| Finding | Location | Reason rejected |
|---|---|---|
| s02-2: anonymous PF reference after a failed record write | `KillSwitchPF.swift:1095-1118, 1208-1218` | Documented trade-off. Harmful only if the record write fails *and* the user's own `/etc/pf.conf` has blocking rules. |
| s03-4: power callback re-blocks after `--emergency-disarm` | – | A narrow race. It self-heals within about 30 s through the core-down watchdog, since the emergency disarm kills the core. |
| s04-2: `SCPreferencesLock(wait:true)` can block | – | Theoretical: needs a hung third-party lock holder. |
| s04-5: TOCTOU between the DNS read and the write | – | Window is milliseconds; negligible. |
| s04-6: sync rereads config.json after stopping the core | – | The app is the only writer, and it serializes. |
| s13-2: a wedged DNS read blocks disarm | – | Deliberate DNS-before-disarm invariant, with a documented emergency escape. |
| s09-4: an abandoned rename overwrites a later tombstone | – | Acknowledged in the `atomic_write` comments; very narrow. |

### GLM-verified bugs Sol missed, in the chunks both covered (8 of 10)

| GLM # | Bug | Chunk |
|---|---|---|
| #1 (P1) | Windows unwanted-intent startup cleanup never retries (`windows_kill_switch.rs:2618-2631`) | s09 |
| #3 | `consecutiveProtectionRepairCount` never reset | s06 |
| #4 | `protectionWasArmed: true` default in activation reconcile | s06 |
| #5 | TUN-missing ticks counted during a switch | s06 |
| #7 | Unarmed connect-failure cleanup overwrites core-stop and system-proxy errors | s05 |
| #8 | Emergency disarm aborts when a stale core survives SIGKILL | s04 |
| #10 | WeChat signed-path leg uses allow-in-place | s12 |
| #12 | Windows missing-snapshot check only recognizes 198.18.0.2 | s13 |

- Sol also missed the #710-covered `status()` single-read heal. Its s03-3 touches `status()` only as a lost-flag variant.
- Not comparable: GLM #6 (s07) and #11 (s08), because those chunks weren't run for Sol.

## Wall time, usage and limits

**Wall time per run:**
- Calibration: 357–516 s (all 4 in parallel; the batch took 8.6 min).
- Scans: s01 467 s, s02 607 s, s03 464 s, s04 676 s, s05 372 s, s06 595 s, s09 405 s, s12 589 s, s13 508 s. Median about 8.5 min per chunk.
- End to end: 14:12–14:47 MT with 3–5 runs at a time, about 35 min for 4 calibration + 9 scan runs.

**Tokens:** 14 sessions (including the killed s07): 11.63M input, of which 10.19M were cache hits, and 121k output (77.6k reasoning).
- Output is about 12× smaller than GLM's (about 930k).
- Sol spends its budget on tool reads (0.4–1.3M input per run), not on reasoning.

**Cost:** there is no per-token charge on the ChatGPT Team subscription, but the 5-hour Codex window went from about 12% (14:18) to 98% (14:47).
- That window was shared with the other Codex process in `/workspace/tono-codex`, which ran about 5 sessions between 14:14 and 14:33.
- My runs cost roughly 3–4 points of the 5-hour window each at xhigh.
- The weekly window was at 15%.
- **Hitting the limit is why s08, s10 and s11 weren't run** and why I stopped the queue.

**Incidents:**
- Editing `sol.sh` while it was running corrupted its tail for s02, s04 and s05. The final answers are intact; the jsonl was restored from backup or session logs.
- The box restarted at about 14:48 and killed s07.

## Head-to-head (same prompts)

| | GLM-5.3 | GPT-6.1 Sol (xhigh, Codex agent) |
|---|---|---|
| Calibration | 2/4 (#229, #139) | 2/4 (#27, #139) |
| Calibration extras FP rate | ~47% (7/15) | ~27% (3/11) |
| Scan FP rate (same 9 chunks) | 60% (18/30) | 34% (10/29), 41% counting unconfirmed |
| Verified real bugs (same 9 chunks, new or covered) | 10 new + 2 covered | 10 unique new vs GLM + 3 covered + 2 overlap |
| Overlap | – | Only 2 bugs in common; the two models are complementary |
| Severity calibration | Inflated | More inflated: nearly all "P0" |
| Per-call wall time | 8–15 min | 6–11 min |
| Cost | $4.68 for 21 calls | $0 marginal, but about 86 points of the shared 5-h ChatGPT Codex window for 14 runs (window hit 98%) |
| Context | Chunk only | Chunk plus self-directed repo reads (a real advantage; several of its bugs are cross-file) |

**Verdict:**
- Sol is noticeably less noisy. Its best findings are cross-file failure-ordering bugs: the PF release ordering (#1), and the stale-armed and lease gaps (#2, #3).
- It repeats the same theme across chunks. It also misses several single-function state-counter bugs that GLM caught: the counters, the default arguments and the tick handling in s06.
- Running both gives much better coverage than either alone.

**To finish the benchmark after 19:10 MT:** run `./sol.sh s07_mac_lifecycle`, `s08_win_killswitch_a`, `s10_win_wfp` and `s11_win_service_mgr` from `/workspace/sol-bughunt`, then verify those findings.
