# Tono 0.0.75 close-out: status and work record at 2026-10-11 ~09:30 UTC

This page records where the work stood when it was written: what is done, what failed, and what is still open.
It is a checkpoint, not live state. Before acting, check [PR #1504](https://github.com/raydocs/tono/pull/1504), its newest head and
comments, and `main`. Links point to fixed commits where possible.

- `MAIN` = [`a8b0be2d5701dbabdb644699547398bdefb99a26`](https://github.com/raydocs/tono/commit/a8b0be2d5701dbabdb644699547398bdefb99a26) (main when written)
- `A13` = [`f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2`](https://github.com/raydocs/tono/commit/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2) (#1504 head when written; ci-gate [38123029736](https://github.com/raydocs/tono/actions/runs/38123029736) still running, no Sol review yet)

## 1. Scope of this round

0.0.75 close-out per [AGENTS.md](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/AGENTS.md) and
[SHIP_PLAN](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/SHIP_PLAN.md). Three goals:
1. First sign-in and connect.
2. Recovery after a failure.
3. Trustworthy protection, with an explicit release.

The owner's requirement for (3) is in [HANDOFF.md](HANDOFF.md).

Owner decisions in force:
- **Decision 092** (approved, with conditions): a failed update, helper replacement or upgrade (including #1071) keeps protection. Automatic paths
  keep protection, and the user must be able to release with **one click**. The release must be bounded and read back PF, DNS, proxy and the AI
  sinkhole/blackhole route. Results are released / partial / unknown, never a faked success. "Ordinary sites work but AI stays blocked" is a FAIL.
  The file is on the A13 branch only: [092](https://github.com/raydocs/tono/blob/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2/docs/decisions/092-2026-10-10-failed-update-keeps-protection.md).
- **Option 2** (owner, 2026-10-11): no test installers until the bounded release (c) is designed, Sol-approved, implemented, reviewed and frozen.
  Do not ship (a)+(b)+(d) with the hard gate marked OPEN. Do not defer (c) to a later candidate.
- **Windows failed-Prepare A/B: PENDING OWNER DECISION.**
  - Today, `apps/windows/app/src-tauri/src/tono/update.rs` (`quiesce_connection_after_update`, around :659–700) releases automatically,
    keeping the AI hold, when Prepare fails while Connected and the Core is running.
  - Silence is not a choice, and agents must not pick A or B.
  - The code is unchanged. Any candidate carries the current behaviour, and that acceptance row reads "pending owner decision".
- No customer feed publish. Agents never tick SHIP_PLAN §6 G1–G3. Device-only gates stay pending until real hardware evidence exists.

## 2. Merged this round (exact SHAs, receipts in PR comments)

| PR | Merge commit | Head | What | Review |
|---|---|---|---|---|
| [#1567](https://github.com/raydocs/tono/pull/1567) | `a8b0be2d5701dbabdb644699547398bdefb99a26` | `d56073dd` | UI copy: 恢复正常网络 everywhere, outlined login restore button, tray 改用 | [Sol PASS + 1 minor](https://github.com/raydocs/tono/pull/1567#issuecomment-6106289656) (fixed), [merge receipt](https://github.com/raydocs/tono/pull/1567#issuecomment-6106381385) |
| [#1566](https://github.com/raydocs/tono/pull/1566) | `80255fe9aa3ef270add30f9ad129c84668c2974b` | `17fd3c30` | Simpler Win/Mac sign-in, click-only safe diagnostics | Sol PASS, [merge receipt](https://github.com/raydocs/tono/pull/1566#issuecomment-6105722627) |
| [#1561](https://github.com/raydocs/tono/pull/1561) | `f50248adccdee04074eedd7672a44a8a840df233` | `7811766f` | New installs default to 简体中文; English kept | Sol PASS + M1/M2 fixed, [merge receipt](https://github.com/raydocs/tono/pull/1561#issuecomment-6105585755) |
| [#1564](https://github.com/raydocs/tono/pull/1564) | `2a7a3b091ed20fc05061f5dae5387f91c6b6f237` | `3a3117ca` | Typed, request-bound sign-in recovery outcome ([decision 093](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/decisions/093-2026-10-11-sign-in-recovery-outcome.md)) | [Sol PASS](https://github.com/raydocs/tono/pull/1564#issuecomment-6105123640), [merge receipt](https://github.com/raydocs/tono/pull/1564#issuecomment-6105256561) |
| [#1565](https://github.com/raydocs/tono/pull/1565) | `336b3c33ebbe9b159fa49e2b53752bb4e06bd82d` | `fb1bbdc5` | Windows DoH cancel regression (test only; [mutation check](https://github.com/raydocs/tono/pull/1565#issuecomment-6105134605)) | coordinator |
| [#1563](https://github.com/raydocs/tono/pull/1563) | `563dc0acba38406ebb837ee1ac6193402c937cbc` | `335d12d8` | Relay-only preflight ([report](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/reports/relay-only-preflight-2026-10-11.md)) | coordinator |
| [#1562](https://github.com/raydocs/tono/pull/1562) | `e47d21654b5215e7e0d7daf315d3d2d22d76503f` | `0448ff38` | #1071 regression handoff ([report](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/reports/ISSUE_1071_A13_REGRESSION_HANDOFF_2026-10-11.md)) | coordinator |
| [#1560](https://github.com/raydocs/tono/pull/1560) | `134e126a12e8c8ace0aa501fc8dd55cea6fbbb5a` | `55f2f47d` | Mainland home-broadband test kit ([kit](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/ops/cn-home-broadband-test-kit.md)) | docs |
| [#1559](https://github.com/raydocs/tono/pull/1559) | `a2dad26b481f4e4ef8c16c1a8c945c1545c4c718` | `2253dc88` | Records: 0.0.75 close-out list | docs |
| [#1558](https://github.com/raydocs/tono/pull/1558) | `5a9bb6095f0c5cffedd57de162cc3a4fbab0b76f` | `45145967` | Paid-launch audit at a6ef4580 | docs |
| [#1557](https://github.com/raydocs/tono/pull/1557) | `eb8909bd3a7905cb7ed5205768483aedfb0fd8e2` | `9464e1b6` | First-run screen discloses traffic-log upload | copy |
| [#1554](https://github.com/raydocs/tono/pull/1554) | `5b13284466b7074609862c7b61bd0763ee8de7ed` | `5ae3fdec` | Windows sign-in with protection held, relay failure text | [Sol PASS](https://github.com/raydocs/tono/pull/1554#issuecomment-6103415510) |
| [#1555](https://github.com/raydocs/tono/pull/1555) | `a6ef4580fe3a890338ad2f9a1ae786c3318c31a0` | `425f6dcb` | Windows relay-only walk latch | [Sol PASS](https://github.com/raydocs/tono/pull/1555#issuecomment-6103295398) |
| [#1553](https://github.com/raydocs/tono/pull/1553) | `62bab6ed59941026da280d02598682ccd623a4cf` | `f5e91755` | Windows relay-only without a healthy tunnel ([decision 091](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/decisions/091-2026-10-10-control-plane-relay-only-without-tunnel.md)) | [Sol PASS (fix round 2)](https://github.com/raydocs/tono/pull/1553#issuecomment-6103147944) |
| [#1552](https://github.com/raydocs/tono/pull/1552) | `1f5b767233f2a9fc2a5fde0c70e0801222e29060` | `3406faff` | macOS relay-only without a tunnel | Sol |
| [#1538](https://github.com/raydocs/tono/pull/1538) | `766ebc4ebca87ae771765bbad99e3e9cf3a15558` | `56a51962` | Third API relay 154.84.56.196:2053 ([decision 089](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/decisions/089-2026-10-10-third-api-relay-other-provider.md)) | Sol |
| [#1506](https://github.com/raydocs/tono/pull/1506) | `dfb06df79551653992d6793348f33c59c32d10b9` | `7255b59b` | macOS "Allow local network devices" (A29, default off) | [Sol rounds](https://github.com/raydocs/tono/pull/1506#issuecomment-6099672439) |

Earlier merges of 2026-10-10 are listed in [#1559's records](https://github.com/raydocs/tono/pull/1559) and `docs/changelog.d/`
(read them with `node tooling/scripts/records.mjs changelog`).

## 3. Not merged: A13 [#1504](https://github.com/raydocs/tono/pull/1504) (one-click release / emergency disarm)

Branch `amp/a13-emergency-disarm-bootout`, head `A13` above. High risk: privileged helper, PF/DNS release, concurrency. Helper version 4.52.50
(main 4.52.49). The design records exist on the branch only:
- [084](https://github.com/raydocs/tono/blob/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2/docs/decisions/084-2026-10-10-emergency-disarm-daemon-restart.md), owner-approved operator release redesign.
- [092](https://github.com/raydocs/tono/blob/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2/docs/decisions/092-2026-10-10-failed-update-keeps-protection.md), a failed update keeps protection.
- [094](https://github.com/raydocs/tono/blob/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2/docs/decisions/094-2026-10-11-user-release-fence-and-drain-cap.md), user-release fence, drain cap and the (c) design.

The [PR body](https://github.com/raydocs/tono/pull/1504) holds the 11-row test matrix, the budget table and the emergency-entry facts.

### Review history (independent reviewer "Sol"; every receipt is a PR comment)

| Round | Head | Result | Receipt |
|---|---|---|---|
| R1–R4 | various | FAIL → redesign (decision 084) | [1](https://github.com/raydocs/tono/pull/1504#issuecomment-6097727690), [2](https://github.com/raydocs/tono/pull/1504#issuecomment-6097948750), [3](https://github.com/raydocs/tono/pull/1504#issuecomment-6099613154), [4](https://github.com/raydocs/tono/pull/1504#issuecomment-6099937952), [R4](https://github.com/raydocs/tono/pull/1504#issuecomment-6100855870) |
| R5 | — | FAIL, 4 major + 1 minor | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6102609122) |
| R6 | — | FAIL, 3 major | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6103539999) |
| R7 | `4b986cfd` | FAIL, 2 major + 2 minor | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6104773058) |
| R8 | `49e24b10` | FAIL, 3 major + 1 minor: late `go` after the commit timeout; swallowed AI readback; update `disconnectVerified` without component readback | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6105800293) |
| R9 | `7f73bd52` | FAIL, 2 major: a failed pfctl query read as "PF released"; an old `disconnectVerified` not cleared before a new attempt. R8 items closed | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106493145) |
| (c) design 1 | `b2124fb7` | FAIL, 5 major (D-F1…D-F5) | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106580712) |
| (c) design 2 | `5b23b163` | FAIL, 3 major (D10-F1 epoch after relaunch; D10-F2 effect/undo not linearized vs Connect; D10-F3 lock-graph cycles) | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106779513) |
| R10 code | `5b23b163` | FAIL: R10-F1 major (a capped old teardown can later stop a new Connect), R10-M1 minor (proxy budget not a ceiling). R9 items closed | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106817973) |
| (c) design 3 | `8632c8c3` (docs only) | FAIL, 4 major (D3-F1 crash-stable lock ownership; D3-F2 cross-incarnation epoch; D3-F3 durable quarantine of legacy/rollback writers; D3-F4 proxy ownership/deadline). Sol: single-lock serialization feasible in principle; recommends a dedicated milestone; size estimate cannot be certified | [receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6106874498) |
| R11 code | `f7c8164f` | **not reviewed yet**: R10-F1 fix (no Connect until a capped release's stale work ends) and R10-M1 budget correction; CI running when written | — |

CI on reviewed heads (all `ci-gate`):
- `49e24b10` [38112669394](https://github.com/raydocs/tono/actions/runs/38112669394): green, 720/0/1 skipped.
- `20da92dd` [38115031354](https://github.com/raydocs/tono/actions/runs/38115031354): **red**. 3 XCTests; the AI-readback message overwrote automatic-release errors.
- `81213742` [38118330337](https://github.com/raydocs/tono/actions/runs/38118330337): **red**. 1 XCTest stub missing.
- `7f73bd52` [38119047390](https://github.com/raydocs/tono/actions/runs/38119047390): green, 723/0/1.
- `b2124fb7` [38120324679](https://github.com/raydocs/tono/actions/runs/38120324679): **red**. The R9-F2 update self-test setup order was wrong.
- `5b23b163` [38121267157](https://github.com/raydocs/tono/actions/runs/38121267157): green, 727/0/1; update self-test 36/36; CONTRACT `4.52.50 0a4d0543…`.

### What the A13 code does at `A13` (implemented, not yet passed review)

- (a) **Fence**: a user release persists `released <n+1>` before acting.
  - Older arm, Core start/sync and DNS enable are refused ("Protection is off. Click Connect in Tono to reconnect.").
  - Only a user Connect (`/session/connect`) re-arms.
  - Launch auto-connect after a user release waits quietly.
  - Known limit: if the disk refuses the write, the fence is memory-only and doesn't bind the update executor or a restarted daemon.
- (b) **Drain cap** of 10 s, only when the helper is known to be fence-aware (its last `/version` this session equals the build). Otherwise the wait is uncapped.
- (d) **Support page** shows `--emergency-disarm` as a last-resort local administrator command. `--emergency-reset` is labelled as helper removal.
- R9 fixes:
  - tri-state PF readback (absent / present / unknown);
  - `disconnectVerified` is durably withdrawn before each update Disconnect;
  - retirement needs live proof that the AI layer is gone.
- R10 fix (unreviewed): a newer Connect waits until a capped release's stale work ends.

### Budget, as stated in the PR (upper limits not measured on a device; not proven ceilings)

| Stage | Seconds |
|---|---|
| Drain cap (fence-aware helper only) | 10 |
| Start-up repair check | 4.7 (+180 admin prompt +45 start-up poll) |
| Release steps | 61 |
| Readback | 8 |
| Total once the release starts | 83.7 (308.7 with repair) |
| Pending-update release | 57 |

- **Not bounded:** the wait behind work already in flight. Contributors:
  - `/update/stage`, 600 s request; its copy/hash/fsync and the update lock (660 s waiters) are not otherwise bounded;
  - an earlier repair prompt;
  - several serial app-actor calls.
- R10-M1: the proxy step uses several 15 s children, a 180 s privileged fallback and `waitUntilExit`, so its number is not a ceiling.
- **The 60 s UI deadline only stops the UI waiting. It is not a release bound.**

### The one-click hard gate (c): OPEN, blocks packaging under Option 2

- Three design rounds failed (table above).
- The worker's round-3 conclusion: (c) needs a helper-wide concurrency rewrite. A rough estimate is 1,500–2,500 lines over 10 helper and 5 app files, 4–6 days plus ≥2 review rounds. **Sol did not certify this estimate.**
- Blocking code at `5b23b163`:
  - `OperatorRelease.swift:283–296` (mode-only `guardedEffect`);
  - lock cycles `SocketServer.swift:1099–1103, 1121–1122, 1018–1020, 1036–1042` and `CoreManager.swift:102–105`;
  - generation held in memory only, `HelperManager.swift:957–980`;
  - in-process DNS SystemConfiguration writes, `ProtectedDNSManager.swift:1192–1201`;
  - serial loop inside the update lock, `SocketServer.swift:401–407, 931`;
  - the app's `PrivilegedRuntimeCoordinator` actor.
- [HANDOFF.md](HANDOFF.md) asks an independent designer to decide whether a smaller provable architecture exists.

### Emergency entry (verified against source in round 9; see the PR body)

- `--emergency-disarm`:
  - latches `released`, boots the daemon out, then releases PF/DNS/AI in bounded steps and reads each back;
  - restarts the daemon only once the release is confirmed; exits 0 only when every readback is released;
  - about 181.5 s total.
- `--emergency-reset`: removes the helper. With an update pending it falls back to the older release without per-component readback.
- Both run from Terminal as root without the app. **macOS has no discoverable entry outside the app.** The CLI exists but nothing outside the app
  points to it. Neither command replaces the in-app one-click release.

## 4. Other open items

- [#1071](https://github.com/raydocs/tono/issues/1071) (abandoned helper upgrade drops the AI hold): its fix is in A13.
  - It was auto-closed when #1562 merged, because #1562's body text "Do not close #1071" matched GitHub's closing keyword.
  - The coordinator **reopened it** on 2026-10-11. It closes only with a fixed SHA plus evidence.
- [#1307](https://github.com/raydocs/tono/issues/1307) Windows exhausted update recovery: open.
- [#1291](https://github.com/raydocs/tono/issues/1291) needs hardware: open.
- [#188](https://github.com/raydocs/tono/issues/188) needs owner confirmation: open.
- [#1543](https://github.com/raydocs/tono/issues/1543) screenshots nightly red: open.
- All three API relays are in Los Angeles. There is no mainland-China evidence yet; the [kit](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/ops/cn-home-broadband-test-kit.md) is ready.

## 5. Freeze and signed packages: NOT DONE

- No final SHA is frozen. No signed candidate exists for this round.
- The last candidates were built at `e99678129` (update sequence 7505;
  [record](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/changelog.d/2026-10-08-candidates-0075-e9967812.md)).
  Sequence **7506 is unused**.
- `release/macos`, `release/windows` and `stability/desktop-0.0.75-20261005` all sit at `e99678129`, an ancestor of main, so they can fast-forward.
- Path once (c) closes and A13 merges:
  1. Freeze one SHA. Acceptance thread runs the combined acceptance on it.
  2. Atomically fast-forward the three branches.
  3. Run `macos-release.yml` and `windows-release.yml` with sequence 7506. Windows needs the `windows-release` environment approval (decision 023).
  4. Run `macos-dmg.yml`.
  5. Verify the bytes: sha256, stamp, helper/CONTRACT, Service rev, 3 relays, minisign/Sparkle.
  6. Write the manifest: hashes, install / upgrade / rollback, shortest test steps, device gates.
  7. Hand over to the owner. No customer feed.

## 6. Device-only gates (pending; no hardware evidence yet)

Owner checklist:
[main version](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/ops/release-0075-owner-g1-g2-checklist.md)
and the [A13 version with G1 step 6 rows 6a–6k](https://github.com/raydocs/tono/blob/f7c8164fcf846c863cf44eb8ae0bd0aa98e087f2/docs/ops/release-0075-owner-g1-g2-checklist.md).
Each of these needs a real Mac or Windows PC with the signed candidate:
- **One-click release (092/A13, G1 6a–6k).** Real PF, DNS, proxy and AI sinkhole/route readback after:
  - a normal release;
  - Prepare/Execute failure;
  - replacement abandon (#1071);
  - an old helper;
  - unreadable status;
  - IPC disconnect/timeout (SIGSTOP the helper);
  - a helper restart;
  - sleep/wake;
  - concurrent stale tasks;
  - repeated clicks.

  Also: the fence after a user release, no late re-blocking, and `--emergency-disarm` on a real Mac.
- **Relay-only preflight gaps** ([report](https://github.com/raydocs/tono/blob/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/reports/relay-only-preflight-2026-10-11.md)):
  - Mac third-relay real HTTPS;
  - PF/WFP all-fail plus grant.
- **UI on installed builds:**
  - fresh install on an English OS, and an upgrade with English saved;
  - cold first frame, Mac reopen;
  - real email and a late result;
  - OS clipboard, VoiceOver/Narrator;
  - UAC/helper/Login Items/protection;
  - the real tray;
  - signed update download/reject/install-failure/rollback.
- **Windows failed-Prepare row:** pending the owner's A/B decision.
- **Mainland network:** home-broadband kit.

## 7. UI screenshots: where they came from (none is device evidence)

| Folder (on main) | PR | Source |
|---|---|---|
| [uiux-restore-copy-2026-10-11](https://github.com/raydocs/tono/tree/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/screenshots/uiux-restore-copy-2026-10-11) | #1567 | Linux Chromium DPR 2, production components, synthetic native IO; not WebView2, not a signed build |
| [login-cleanup-2026-10-10](https://github.com/raydocs/tono/tree/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/screenshots/login-cleanup-2026-10-10) | #1566 | Windows: Linux Chromium synthetic. Mac: hosted macOS CI real SwiftUI window with a synthetic account ([CI 38110583500](https://github.com/raydocs/tono/actions/runs/38110583500)) |
| [default-language-2026-10-10](https://github.com/raydocs/tono/tree/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/screenshots/default-language-2026-10-10) | #1561 | Windows: Linux Chromium. Mac: hosted macOS CI window, synthetic state ([CI 38106296606](https://github.com/raydocs/tono/actions/runs/38106296606)) |
| [windows-login-relays-2026-10-10](https://github.com/raydocs/tono/tree/a8b0be2d5701dbabdb644699547398bdefb99a26/docs/screenshots/windows-login-relays-2026-10-10) | #1554 | Linux Chromium synthetic shell |

Each folder's README states its exact source commit and limits. GitHub Actions artifacts expire after 7 days.

## 8. Who owns what (Amp threads; links need an Amp login)

| Role | Thread | Owns |
|---|---|---|
| Coordinator (integration, merges, dispatch) | T-01a12506-8674-77da-a956-c31ff53add43 | merges, records, candidate builds |
| A13 worker (one Claude worker; no second worker) | runs inside the coordinator session | branch `amp/a13-emergency-disarm-bootout`: helper `tooling/scripts/core-helper/*`, app `HelperManager`, `AppState+Connect`, `ConnectionCoordinator`, `SupportView`, decision 094 |
| Independent reviewer "Sol" | T-01a126c1-8b2b-741f-b212-3669beb1724d | high-risk review receipts (serial) |
| Acceptance | T-01a12708-4574-7044-82b6-441016c0e1ee | combined acceptance on the frozen SHA only |
| UIUX | T-01a126eb-09cb-760d-9832-243953a795ff (done), T-01a12971-7725-74d7-996f-551fb0a60b57 (#1567 done) | UI copy and layout only |
| Audit | T-01a12823-c5fb-750e-bf79-166b2b0f34d9 | evidence only; must not write `HelperManager` while A13 owns it |
| Puck | T-01a12527-6258-75e2-a022-8b47669fc1b4 | relays the owner |

An independent designer working from [HANDOFF.md](HANDOFF.md) should not edit the A13 branch. Its output is a design to review.

---

## 9. Continuation: 2026-10-11 ~11:10 UTC (A13 paused by the owner)

### Owner decision (via Puck)

- **A13 is paused.**
  - Speculative new-architecture work on (c) stops, and so do new edits to recovery-related product source.
  - The existing worker stopped at a safe checkpoint. Nothing was discarded or reset, and no new implementation worker was started.
- **What continues:** read-only review of exact heads that already exist, evidence collection, and other explicitly scoped work.
- **#1504 as a whole has NOT passed.** The pause does not merge it and does not build packages.
- **Owner decision 2 still stands:** packages wait for a reliable release design. This is not open for re-choosing unless the owner changes it.
- **Hard-gate boundary.** Sol's boundary below (a bounded attempt with an honest result; restoration is not unconditional) needs the owner's explicit approval. It is **not** assumed.
- **Next design path:**
  1. A separate AI (Claude Projects) writes a pre-emptive recovery experiment design on its own branch.
  2. The original reviewer (Sol) reviews that design.
  3. The prerequisites are then verified on dedicated, known-recoverable Mac/Windows machines: late DNS commit, launch isolation, crash recovery.
  4. The owner approves the results and the architecture.
  5. Only then is a single implementation owner and file ownership set, with phased implementation and exit conditions. No two parties write the helper in parallel.
- **Not yet provided:** the document links and test machines. They are not assumed, and no destructive experiment is started.

### Pause checkpoint (confirmed by the worker)

- PR branch `amp/a13-emergency-disarm-bootout` head is
  [`84a88ed4db421a2b6e0a1c805997bfdb5433a4d0`](https://github.com/raydocs/tono/commit/84a88ed4db421a2b6e0a1c805997bfdb5433a4d0).
  It holds the R11-F1 fix, pushed before the stop arrived.
- No unpushed commits and no uncommitted changes, so there is no WIP branch and no patch file.
- The worker is idle and waiting. Design round 5 was cancelled before it started.
- CI on 84a88ed4: ci-gate [38124552364](https://github.com/raydocs/tono/actions/runs/38124552364) was still running at the pause. The new regression is **not yet proven**.

### #1504 itemized after the pause (exact SHA / CI / Sol)

| Item | Fixed at | CI | Sol |
|---|---|---|---|
| R8-F1 late `go` after commit timeout | `20da92dd` (claimGo) | green at `7f73bd52` ([38119047390](https://github.com/raydocs/tono/actions/runs/38119047390)) | closed in R9 |
| R8-F2 swallowed AI readback | `20da92dd` + `81213742`/`7f73bd52` | green at `7f73bd52` | closed in R9 |
| R8-M1 budget nested calls | `20da92dd` | green at `7f73bd52` | closed in R9 |
| R9-F1 failed pfctl query read as released (tri-state) | `b1d31856` | green at `5b23b163` ([38121267157](https://github.com/raydocs/tono/actions/runs/38121267157)) | closed in R10 |
| R9-F2 stale `disconnectVerified` | `b1d31856` (test order fixed in `5b23b163`) | green at `5b23b163` | closed in R10 |
| (a) fence, (b) drain cap with capability gate, (d) Support `--emergency-disarm` | `b1d31856`/`b2124fb7`/`5b23b163` | green at `5b23b163` | reviewed in R10. Fence accepted except for R10-F1. Dashboard copy and retry restriction accepted |
| R10-F1 capped teardown stops a new Connect | `f7c8164f` | green ([38123029736](https://github.com/raydocs/tono/actions/runs/38123029736), 728/0/1) | **R11 FAIL** at `f7c8164f`: R11-F1 permanent wait cycle ([receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6107059593)) |
| R10-M1 proxy budget | `f7c8164f` (no fixed bound; contributors listed) | green | closed in R11 |
| R11-F1 capped-work cycle | `84a88ed4` (per-request registry, strictly older deps; regression `testRepeatedCappedReleasesWithTheNewerCapFirstFormNoCycle`) | **running** at pause | **not reviewed** |
| (c) queue-independent bounded release | design only | — | **FAIL x4**. Round 4 at `2d757c1c` ([receipt](https://github.com/raydocs/tono/pull/1504#issuecomment-6107144656)): D4-F1 outside-lock PF flush; D4-F2 spawn identity / effect lifetime; D4-F3 rollback below floor after Connect; D4-F4 clock can't interrupt fsync/readback/reap; D4-M1 repair incarnation |

### Sol's boundary on the hard gate (round 4; owner approval pending)

- Feasible: a bounded local release attempt that always returns an honest released / partial / unknown.
- Not feasible: unconditional restoration despite unreapable kernel work, or despite a non-cooperating root downgrade (an older Tono app reinstalling its older helper with an administrator password). A 50 s answer is not restoration evidence.
- The worker's estimate of about 3,400–5,400 lines over about 3–4 weeks is "plausible but uncertified" and **not freeze-safe**.
- Directionally sound: the epoch compare-and-swap with replay, and the helper-owned proxy.
- DNS proof: accepted only as a conditional real-Mac gate.

Unchanged from above: no freeze, no signed packages, all device gates pending, Windows failed-Prepare A/B pending the owner.
