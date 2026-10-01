Operator follow-up: #1025 is merged, but its PR body needs a source-line correction, `442 → 459`. `gh pr edit` failed twice on GitHub’s deprecated Projects API. Branch: `hunt/sol-r3svc-prior-commit-cleanup`; title: “fix(windows): clean committed backups before the next update”; [corrected body](/workspace/w1-codex/out/R3-W4W7/prior-cleanup-pr-body.md). All commits are pushed.

**Five verified bugs fixed and merged through CI: three P1, two P2.** The automatic-release fixes retain AI blocking and preserve strict mode.

Paths below are relative to `apps/windows/service/src`; lines identify audited baselines. FP means rejected or unproved for this hunt.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-UNVERIFIED-STARTUP-AI-HOLD | W4 | P1 | core/windows_kill_switch.rs:3410 | Interrupted first connection loses AI hold during startup cleanup | Fixed in #1005 |
| WIN-PREPARE-FAILURE-AI-HOLD | W7 | P1 | core/update.rs:535 | Failed Prepare releases without AI hold | Fixed in #1007 |
| WIN-SCM-STOP-AI-HOLD | W4 | P1 | core/server/mod.rs:578 | Automatic Service stop removes AI hold | Fixed in #1014 |
| WIN-COMMITTED-CLEANUP-RETRY | W7 | P2 | bin/install_service/update_executor.rs:768 | Locked backup deletion falsely succeeds and retires retry task | Fixed in #1017 |
| WIN-PREPARE-COMMITTED-BACKUPS | W7 | P2 | core/update.rs:459 | Later Prepare supersedes unfinished committed cleanup | Fixed in #1025 |
| R3S-02 | W4 | — | core/windows_kill_switch.rs:2819 | Verified startup reconciliation blocks forever | FP: independent 30-second recovery deadline |
| R3S-03 | W4 | P2 | core/windows_kill_switch.rs:3360 | Unverified cleanup error retains block | FP: ordinary trigger unproved; separate failures required |
| R3S-04 | W4 | — | bin/service.rs:446 | Successor exits without SCM recovery | Duplicate: existing nonzero fatal-exit fix |
| R3S-05 | W4 | P2 | core/reconcile.rs:41 | Cleanup termination targets reused PID | Duplicate #994; takeover timing unproved |
| R3S-06 | W4 | P2 | bin/service.rs:91 | Standalone runtime drop hangs | FP: manual/admin standalone path outside scope |
| R3S-07 | W4 | — | core/owner.rs:87 | Metadata-write failure itself cuts network | FP: startup refusal does not arm filters |
| R3S-08 | W4 | — | core/maintenance.rs:9 | Stale-owner maintenance retains filters | FP: explicit administrative maintenance path |
| R3S-09 | W4 | — | bin/service.rs:250 | Repeated SCM Stop dispatch hangs | FP: one-shot reservation and nonblocking send |
| R3S-10 | W4 | — | bin/service.rs:492 | Runtime shutdown waits indefinitely | FP: `shutdown_background` prevents waiting |
| R3S-11 | W4 | — | core/runtime.rs:98 | Corrupt runtime record wedges starts | Duplicate #775 |
| R3S-12 | W4 | — | core/desired.rs:249 | Reboot replays stale run intent | Duplicate BRICK-W1 boot-session guard |
| R3S-13 | W4 | — | core/desired.rs:189 | Retired owner resurrects Core | FP: desired stopped state persists first |
| R3S-17 | W7 | — | update_transaction.rs:332 | Lost acknowledgement repeats consumption | FP: persisted sequence and executor binding |
| R3S-18 | W7 | — | update_transaction.rs:453 | Archive failure clears live obligation | FP: archive persistence precedes clearing |
| R3S-19 | W7 | — | update_transaction.rs:571 | Restarted successor cannot adopt | FP: target-identity process can rebind |
| R3S-20 | W7 | — | update_transaction.rs:381 | Restarted original App cannot Disconnect | FP: owner image identity remains accepted |
| R3S-21 | W7 | — | core/update.rs:461 | Extraction deadlocks on Store | FP: parent drops Store before waiting |
| R3S-22 | W7 | — | core/update.rs:341 | Another owner adopts pending update | FP: receipt-owner guard |
| R3S-23 | W7 | — | update_wire.rs:9 | Wire request injects proof phase | FP: no proof fields; unknown fields rejected |
| R3S-24 | W7 | — | update_transaction.rs:17 | Additive fields corrupt older journals | FP: documented optional-field schema contract |
| R3S-25 | W7 | — | update_transaction.rs:324 | Receipt expiry prevents recovery grants | Duplicate decision BRICK-W6 |
| R3S-26 | W7 | — | bin/install_service/update_executor.rs:359 | Published-target recovery misses restart | Duplicate #858 documented limitation |
| R3S-27 | W7 | — | bin/install_service/update_executor.rs:558 | SCM configuration failure leaves Service stopped | Duplicate BRICK-W9 subset; native trigger unproved |
| R3S-28 | W7 | — | core/update.rs:213 | Artifact-size addition overflows | FP: signed artifacts capped at 4 GiB |
| R3S-29 | W7 | — | core/update.rs:780 | Ordinary user forges replacement plan | FP: private SYSTEM plan and path bindings |
| R3S-30 | W7 | — | core/update.rs:158 | Dead installer lease permits Connect | FP: exception admits Status only |
| R3S-31 | W7 | P2 | core/update/security.rs:735 | Recovery resumes unrelated suspended threads | FP: separate suspension and executor failure; unproved |
| R3S-32 | W7 | — | core/update/security.rs:90 | Default TrustedInstaller ACL rejects updates | Duplicate #352 |
| R3S-33 | W7 | — | bin/install_service/update_executor.rs:262 | BFE timeout hangs installer runtime | Duplicate-fixed #776 |
| R3S-34 | W7 | — | core/update.rs:464 | Hung extractor cuts network | FP: Core stops after extraction; outage unproved |
| R3S-36 | W7 | P3 | core/update.rs:459 | Later Prepare loses registry-version retry | FP: both registry writes must fail; no native reproduction |

| PR | Status | Auto-merge | Labels |
|---|---|---|---|
| [#1005](https://github.com/raydocs/tono/pull/1005) | Merged, CI passed | Merge commit | `needs-hardware` |
| [#1007](https://github.com/raydocs/tono/pull/1007) | Merged, CI passed | Merge commit | `needs-hardware` |
| [#1014](https://github.com/raydocs/tono/pull/1014) | Merged, CI passed | Merge commit | `needs-hardware` |
| [#1017](https://github.com/raydocs/tono/pull/1017) | Merged, CI passed | Merge commit | None |
| [#1025](https://github.com/raydocs/tono/pull/1025) | Merged, CI passed | Merge commit | None |

**36 hypotheses: 22 false positives/rejected leads, nine duplicates, five verified fixes.** Startup and stop regressions failed locally before their fixes. Portable checks passed: 96 WFP, 17 installer and 14 journal tests. Windows CI passed every new regression.

All assigned source review is complete. Installed-device crash, reboot, Stop, DNS/WFP and update validation remains for the hardware batch. [Full report](/workspace/w1-codex/out/R3-W4W7/report.md) and [incremental findings](/workspace/w1-codex/out/R3-W4W7/findings.tsv) are saved.

A mistaken settings change on #1008 was reverted; its code and branch were untouched.