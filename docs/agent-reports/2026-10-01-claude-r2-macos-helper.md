# Round 2 bug hunt: macOS root helper (2026-10-01)

Hunter: Claude Opus 5.5 (Claude Code). Module: `tooling/scripts/core-helper` (KillSwitchManager, KillSwitchPF,
ProtectedDNSManager, SelectiveFailOpen, SocketServer watchdogs, HelperPower, emergency disarm/reset, app-removal
cleanup, update executor/runtime) and `tooling/scripts/helper-shared`. Baseline main `626b1d74` (helper 4.52.31);
#1222 (4.52.32) merged first, then this hunt's PRs were serialized on top of it.

Source reading and read-only checks only. Nothing on this Mac changed PF, DNS, routes, the helper or system
services; Swift and helper self-tests run on hosted macOS CI.

**New P0/P1: none found.**

## Findings

| ID | Area | Severity | File:line (main `7e423077`) | Description | Verdict |
|---|---|---|---|---|---|
| KNOWN-GAP-SELECTIVE-HOOK | App → helper fail-open | (P1 claim) | `AppState.swift:2098`, `AppState+Catalog.swift:335`, `AppState+Proxy.swift:270`; `SocketServer.swift:651`; `KillSwitchManager.swift:620` | Handoff gap: "selective AI block hook not registered, so #963/#966 fail-open restores the network without blocking AI" | **False on current main.** `selectiveAiBlockReady` is still always `false`, but the `.failOpen` branch it picks calls `disconnect(releaseKillSwitch: true, automaticFailureRelease: true)` → `releaseAfterFailure` → `POST /killswitch/release` → `disarm(preserveAIHold: true)` → `releaseWithAIHold` → `SelectiveFailOpenInstaller.applyBestEffort()` (AI suffix resolver sinkhole + Anthropic prefix blackholes). The unreachable `.selectiveFailOpen` / `.selectiveRelease` branches are placeholders for a PF/WFP-level hook (decision 031); no fix needed. |
| R4FMA-ROUTE-OWNERSHIP | SelectiveFailOpen | P2 | `SelectiveFailOpen.swift` `removeBestEffort` | Cleanup deleted a preexisting non-Tono route for exactly `160.79.104.0/23` / `2607:6bc0::/48` | **Fixed in #1263** (merged, helper 4.52.33): read-only `route -n get` first; skip delete only for an exact-prefix route without `BLACKHOLE`; anything unclear still deletes. Closes #1164. |
| MAC-REMOVAL-STALE-CORE | main.swift app-removal cleanup | P3 | `main.swift` `releaseRemovedInstallationLocked` | Since #763 removal deleted the helper while a Core that survived SIGKILL could still run | **Fixed in #1268** (auto-merge set, helper 4.52.34): new `coreStillRunning` outcome keeps the installation and retries. Closes #1251. |
| MAC-ORPHAN-TUNNEL-SESSION | SocketServer watchdog | P2 | `SocketServer.swift` `observeCoreForWatchdog` | App dies while connected: helper keeps the committed tunnel + PF indefinitely; a later exit outage cuts the network until Tono is reopened | **Real, unfixed: decision item #1269.** Needs two events (App death + exit outage); releasing a working tunnel is a product choice. Sleep/wake already heals it. |
| HELPER-UPGRADE-ABANDON-AI | App helper upgrade | P2 | `HelperManager.swift:259` | Abandoned helper upgrade releases with explicit `KillSwitchService.disarm()` (drops the AI hold) | **Duplicate of #1071** (do-not-touch decision item). |

## Hypotheses rejected (false-positive log)

1. Watchdog releases an in-progress connect after wake: the core-down counter resets on every arm/release commit (`openNetworkEpoch`); wake keeps the emergency block until the App arms, and a failed or absent App gets the 30 s core-down release with the AI hold. Not a bug.
2. `releaseWithAIHold` drops the AI layer when `release()` throws partway: the `retain-ai` disposition is written first; with the state file left, the watchdog retries; with it gone, `reconcileSelectiveRecoveryIfReleased` applies the layer. Covered.
3. Selective resolver sinkhole outliving a reconnect and breaking AI names while Connected: every successful arm (bootstrap arm included) calls `removeBestEffort()`. Covered.
4. Idle-loop `recoverDNSAfterStoppedCore` undoing a connect's DNS before the Core starts: the branch with a saved state file returns before DNS recovery until the core-down threshold. Covered.
5. Silent upgrade `--version` probe hanging the single request thread: the candidate must pass `verifyCode` for the signed helper identifier before it runs. Not reachable.
6. `KillSwitchManager.run` hanging on a child that fills its pipe: output is drained on its own thread; SIGTERM then SIGKILL past the deadline. Not a bug.
7. Update executor failure leaving PF up: the catch path runs `releaseInstalledBlock`, DNS restore and the AI layer, then marks the attempt blocked (BRICK-M8 fix). Covered.
8. Emergency disarm removing the AI layer: that is an administrator's explicit recovery, which counts as Restore under decision 036. Deliberate.
9. App-presence check removing the helper mid-session: a running signed Tono client counts as present, and an unreadable pid or lookup counts as present too. Not reachable while the App runs.
10. Removal racing a Finder replace of `/Applications/Tono.app`: at worst the helper uninstalls and the next launch asks for an administrator reinstall. No network loss. Not filed.
11. `ProtectedDNSManager.enable` treating an original `[127.0.0.1]` as a Tono leftover: already known (BRICK-M12 / R4FMA-DUPLICATE-DNS-RESTORE, P2).

Hypotheses examined: 16. Real: 4 (2 fixed, 1 new decision issue, 1 duplicate of #1071). False positives: 11. The known gap above was also refuted.

## PRs and issues

- #1263: fix #1164. Merged (ci-gate green on head `eca512c8`). Label `needs-hardware`.
- #1268: fix #1251. Auto-merge set; label `needs-hardware`. Stacked after #1263 for the version bump.
- #1269: new decision issue (MAC-ORPHAN-TUNNEL-SESSION, P2).

## Not covered

- I did not do a line-by-line pass over `KillSwitchPF.swift` rule rendering or `UpdatePackage` / `UpdateZIP` validation. Earlier rounds covered both in depth (see the findings ledger). I reviewed only the paths named above.
- Hardware: a real /23 and /48 blackhole readback (#1263); an unkillable-Core removal (#1268).
