# RegLate (macOS) regression review — 2026-10-01

Slot: union of `codex-r4-prompt-RegLate.md` and `codex-r4-prompt-RegLate2.md`, restricted to macOS
(`apps/macos`, `tooling/scripts/core-helper`, `helper-shared`, macOS sing-box runtime, macOS release tooling).
Scope: every PR merged since 2026-10-01T04:45Z that touches those paths; list refreshed at the end (through #1214, 10:07Z).
Baseline: origin/main `0676435b` for the first pass, `b9ab47db` for the refresh. Code reading, `gh pr diff`, git history only.
Nothing compiled or run on the MacBook (no xcodebuild/swift/PF/DNS); XCTest and helper self-tests run in hosted CI.

Severity per the slot prompt (strict): P0 = single plausible failure → network loss / crash / sign-in / data exposure;
P2 at most for two independent failures, admin misconfiguration or millisecond races.

## Result

- No P0 or P1 found in this slot.
- Fixed: REGLATE-MAC-F3 (P2, TOP RULE: leftover pre-receipt AI sinkholes hold every connect) in #1237;
  REGLATE-MAC-F1 and REGLATE-MAC-F2 (P3) in #1231.
- Issues opened: #1238 (P2 DIRECT revocation lost), #1239 (P2 DNS lock blocks disarm), #1240 (P3 manifest compatibility / release gate note).
- Known gap check ("selective AI block hook not registered, so #963/#966 fail-open restores the network without blocking AI"):
  **not a P0/P1, and not a live gap.** `selectiveAiBlockReady` is the unused in-place hook, but every non-strict
  fallback that reaches `.releaseOriginalNetwork` / `.failOpen` calls `disconnect(releaseKillSwitch: true, automaticFailureRelease: true)`
  → `networkProtection.releaseAfterFailure()` → helper `POST /killswitch/release` → `KillSwitchManager.disarm(preserveAIHold: true)`
  → `SelectiveFailOpenInstaller.applyBestEffort` (Anthropic prefixes blackholed, first-party AI suffixes sinkholed).
  Catalog removal: `AppState+Catalog.swift:365,391`; policy failure: `AppState.swift:2095`; switch failure: `AppState+Proxy.swift:272`;
  exhausted failures: `AppState+Connect.swift:2281-2285`; unarmed failure: `:986-987`. The doc comments in `ProxyNode.swift:281`,
  `ProtectedConnectivity.swift:67` and `ExitHeal.swift:67` describe the hook, not the effective behaviour. No fix needed.
- Helper contract: main 4.52.28 hash recomputed and matched `CONTRACT.sha256` (`f056394f…`); after #795 main is 4.52.29; #1237 bumps to 4.52.30.

## REG table

| ID | Verdict | Note |
|---|---|---|
| REG-1048 | ok | Exhausted failure releases through `/killswitch/release` with the AI hold. Sibling: abandoned helper upgrade (see N4). |
| REG-1064 | ok | Executor cleanup before slot clear; a failed cleanup keeps reconnect blocked with internet already released. |
| REG-1061 | ok | Unarmed failure uses `releaseAfterFailure`; a 404 from an older helper has no PF to release. |
| REG-963 | ok | Non-strict fallback keeps the AI hold (see known-gap note); keepSession is serialized by `finishPendingDisconnect`. |
| REG-964 | ok | Release job proves peer authorization with the imported Developer ID; signing/notarization unchanged. |
| REG-966 | ok | Policy changes during connect apply after `isConnected` and read the latest policy. |
| REG-958 | concern (P3, unsure) | AI routing still first. Web-direct fake-IP suffixes `qq.com`/`weixinbridge.com` also catch WeChat DNS names, so exact-IP WeChat endpoints on non-80/443/8000/8080 ports may hit the reject rule (`ConfigPipeline+SingBoxProduct.swift:219-254`). No AI/network-cut impact. |
| REG-1086 | regression-fixed #1231 | With no selected exit the unarmed loop spun on the 2 s rung forever (REGLATE-MAC-F1). |
| REG-785 | ok | Release published right after verified Disconnect; bookkeeping waits for retire. |
| REG-979 | ok | Signature checks moved onto the copied files before the version probe. |
| REG-1001 | ok | Wake/sleep tasks drained before native update release; no deadlock path. |
| REG-1103 | ok | Catalog and policy cleanup route automatic/unarmed failures to `releaseAfterFailure`. |
| REG-1084 | ok | DashScope/maas suffixes added to routing and to the selective hold. |
| REG-1115 | concern → issue #1238 | Rebuild is correct, but a failure before `/core/sync` never re-queues the accepted policy. |
| REG-886 | ok | Bounded fake-IP wait (1/2/2 s); failure still releases with the AI hold. |
| REG-1126 | ok | Only the success-path advisory `/delay` is deferred; failure detection unchanged. |
| REG-1110 | ok | Blackhole routes get gateways; added on release, removed on arm. |
| REG-1136 | ok | Durable `retain-ai`/`released` disposition used by watchdog, startup and orphan paths. |
| REG-867 | ok | Assistant TCP route / UDP reject precede every DIRECT rule. |
| REG-1099 | regression-fixed #1231 | Sibling: unarmed connect failure with a pending update used the explicit update Disconnect and dropped the AI hold (REGLATE-MAC-F2). Also see N5. |
| REG-1146 | ok | Full reload failure restores internet; no conflict with the release chain. |
| REG-1149 | ok | Queue/drain order (removal → policy → pins → full) holds; gap is #1238. |
| REG-1144 | concern → issue #1239 | Snapshotless restore always activates; combined with #1154 the second restore in `KillSwitchService.disarm` can block the disarm on a preferences-lock race. |
| REG-1153 | ok | Stale pins cannot restore revoked grants via the captured-state guard (sibling in #1238). |
| REG-1158 | concern → issue #1238 | Keeping the removed selection while an owner is busy lets the optional-policy owner fail with `invalidNode` and drop the accepted policy. |
| REG-1154 | concern → issue #1239 | See REG-1144. |
| REG-1166 | ok | `O_NONBLOCK` + `fstat` regular-file check; bundle and signature checks unchanged. |
| REG-1135 | ok | LAN DNS scope widening runs under the helper lock against the committed pass-rule baseline. |
| REG-1130 | ok | Per-attempt private staging; both renames under the update lock. |
| REG-1141 | regression-fixed #1237 | Receipt-less sinkholes from older helpers are never removed and are recorded as originals; the connected DNS audit then holds every connect (REGLATE-MAC-F3). |
| REG-1178 | ok | requestID guard skips convergence only when a newer owner exists. |
| REG-1159 | concern → issue #1240 | Optional `singBoxSha256` in the joint manifest is rejected by every v1 reader built before #1159 (canonical re-encode / `deny_unknown_fields`). No published customer build uses v1, so P3; release gate note. Helper bump 4.52.28 consistent. |
| REG-1179 | ok | Signer download pinned to the same SHA-256 as the workflows; `codesign --verify --strict` added. |
| REG-795 | ok | Protected Offline receipt accepts an observed Unprotected only in recovery/commit; AI hold on that release unchanged; helper 4.52.29 + contract consistent. |
| REG-1217 | ok | Build guard rejects a matching hash with a different recorded version; guard test PASS locally (no compile). |
| REG-1214 | ok | Empty gzip probe (20 bytes, `X-Tono-Log-Lines: 0`) passes server validation (`telemetry/routes.ts:205-256`); no log line leaves before the server confirms. |
| REG-1092, 1202, 1205 | n/a | Docs only. |
| REG-1140, 1157, 1175, 1196, 1188 | n/a | Windows only; no `apps/macos` or shared sing-box generator files. |
| REG-663 | n/a | Merged into `release/windows`, not main; Windows scope. |

## New findings

| ID | Sev | Where (main) | Trigger → effect | Status |
|---|---|---|---|---|
| REGLATE-MAC-F3 | P2 (TOP RULE) | `SelectiveFailOpen.swift` `writeResolvers` / `removeResolvers`; audit `SystemProxy.swift:555-621`, hold `AppState+Connect.swift:2562-2580` | A Mac that ran a helper older than 4.52.27 (dev builds, the 10-01 05:12Z candidate from `stability/desktop-0.0.74-20260926` @ `7d33a838`) and had an automatic release keeps `/etc/resolver/<AI suffix>` → `192.0.2.1` without a receipt. Cleanup skips it, apply records it as the original, and the connected DNS audit treats it as a supplemental conflict → PF held, retries paused, on every connect. | fixed in #1237 (helper 4.52.30) |
| REGLATE-MAC-F1 | P3 | `AppState+Connect.swift` `scheduleUnarmedReconnect` | No selected exit → `preferred = ""` → proofs of "other"-region nodes → `nil == ""` resets to the 2 s rung forever. Battery/network noise only. | fixed in #1231 |
| REGLATE-MAC-F2 | P3 | `AppState+Connect.swift:727-731` | Unarmed connect failure while a launch-owned update is pending → explicit `/update/disconnect` → AI layer removed. | fixed in #1231 |
| N1 (#1238) | P2 | `AppState.swift:2055-2072`, `AppState+Catalog.swift:339-343,929-933,1040` | Optional-policy owner failure (catalog removal mid-apply, or any transient arm/write failure) never re-queues the accepted policy; pins refresh then merges new pins onto the old DIRECT grants. No AI leak (assistant-first rules and AI admission guards hold). | issue #1238 |
| N2 (#1239) | P2 | `ProtectedDNSManager.swift:596,1094`, `KillSwitchService.swift:332-334` | Second snapshotless DNS restore before disarm takes a non-blocking preferences lock; contention throws, the disarm is never sent, the network stays held until retry or the helper watchdog (AI hold kept). | issue #1239 |
| N3 (#1240) | P3 | `UpdateContractV1.swift:24-25,212-218`; `desktop-update-sign.yml:461` | Manifest carrying Windows `singBoxSha256` is rejected by v1 readers built before #1159 (0.0.73 RC, `release/macos` @ `3635fc93`, the 05:12Z candidate). Dropping `--sing-box` alone breaks the new Windows service comparison. | issue #1240, release/owner decision |
| N4 | P2 → #1071 | `HelperManager.swift:251-262` | An abandoned helper upgrade with PF armed releases through `/killswitch/disarm` (no AI hold). This is the helper-upgrade AI-hold question owned by decision #1071; not changed here. | report to owner (#1071) |
| N5 | P3 | `AppState+Connect.swift:727-734,2287` | TUN loss while a native update is mid-install skips every release (the #891 exclusion predates #1099's AI-hold update release). Window is the seconds before `suspend()`; the update then disconnects. | open, not filed |
| N6 | P3 | `AccountSession+Auth.swift:39-47` | Signed-out launch with no armed latch calls the full `/killswitch/disarm`, dropping an AI hold left by an earlier automatic release. Overlaps decisions #1120/#1052. | report to owner |
| N7 | P2 dup | `AppState+Connect.swift:1153-1167`, `UpdateTransaction.swift:312-313` | Stale launch-owned pending flag after a lost commit reply sends releases to the update route, which the helper refuses. | duplicate of #1151 / #1132 |

## Rejected hypotheses (false positives)

- #1086 retry loop deadlocks on the disconnect queue: nothing in the queue awaits the retry task.
- #1086 periodic re-arm cuts the network: pre-existing and now capped at 120 s.
- #1086 backoff reset by a later success: reset only after verified data plane, intended.
- #886 timer races the callback: `finish` runs once under the lock.
- #1126 stale probe after disconnect: generation check plus `SingBoxDelayGate`.
- #958 UDP for web-direct names goes direct: intended; assistant UDP reject comes first.
- #958 cached fake IPs after release: 30 s rewrite TTL, same as existing fake-IP names.
- #1064 strands emergency recovery / bootout kills a running executor: retire failure is caught after PF release; retire holds the update lock.
- #1099 against an old helper: the native update replaces helper and app together.
- #979 dropped helper/core signature checks: moved onto the copied files.
- #1130 cross-filesystem rename: staging is on the same volume, private per attempt.
- #1166 rejects legitimate files: realpath'd open, regular file passes.
- #1159 changes existing macOS manifest hashes: nil is omitted from canonical bytes.
- #1149 clearing `pendingDirectPolicyReload` loses pins: the full rebuild re-resolves them.
- #1115 transition union exceeds the 256-endpoint ceiling: old endpoints reserved in the pin budget.
- #1135 re-adds revoked grants: requires the committed pass-rule baseline under the helper lock.
- 6 s receive timeout on `/killswitch/release` with synchronous apply: same timing as the old remove; status readback covers a lost reply.
- Arm writes `retain-ai` then fails: the next release is automatic and keeps the hold anyway.
- Known gap (selective hook) as P0/P1: see Result; the helper AI hold covers every automatic path.

Hypotheses examined: 30 including the known-gap check. Real: 10 (3 fixed, 3 issues, 1 duplicate, 3 reported only). Rejected: 19.

## PRs from this pass

- #1231 `fix(macos)`: REGLATE-MAC-F1 + F2, `needs-hardware`, auto-merge set.
- #1237 `fix(macos-helper)`: REGLATE-MAC-F3, helper 4.52.30, `needs-hardware`, auto-merge set.
- Issues: #1238, #1239, #1240.
