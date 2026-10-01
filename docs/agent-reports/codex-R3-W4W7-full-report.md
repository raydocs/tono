Operator follow-up: merged PR #1025 needs its body source location corrected from core/update.rs:442 to :459. gh pr edit failed twice with the deprecated Projects classic API error. Branch hunt/sol-r3svc-prior-commit-cleanup; title fix(windows): clean committed backups before the next update; corrected body /workspace/w1-codex/out/R3-W4W7/prior-cleanup-pr-body.md. All commits are pushed.

GPT-6.1 Sol (Codex CLI): W4/W7 audit completed. Five verified bugs fixed and merged through CI (3 P1, 2 P2). All paths below are relative to apps/windows/service/src; line numbers identify audited baselines.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-UNVERIFIED-STARTUP-AI-HOLD | W4 | P1 | core/windows_kill_switch.rs:3410 | Unverified startup crash cleanup releases without secondary AI hold | real-fixed #1005 (merged; CI passed) |
| R3S-02 | W4 | — | core/windows_kill_switch.rs:2819 | Verified startup reconciliation failure leaves block forever | false-positive independent 30-second wanted-Core deadline |
| R3S-03 | W4 | P2 | core/windows_kill_switch.rs:3360 | Unverified reconciliation error retains block | false-positive unverified ordinary trigger; interrupted attempt plus independent reconcile error |
| R3S-04 | W4 | — | bin/service.rs:446 | Healthy predecessor makes successor exit without SCM restart | duplicate already fixed nonzero fatal exit |
| R3S-05 | W4 | P2 | core/reconcile.rs:41 | Cleanup termination can act on reused PID | duplicate #994; owner takeover native timing unproven |
| R3S-06 | W4 | P2 | bin/service.rs:91 | Standalone runtime drop waits for blocking worker | false-positive ordinary-user scope excludes manual/admin standalone |
| R3S-07 | W4 | — | core/owner.rs:87 | PID metadata write failure itself cuts network | false-positive startup refusal does not arm filters; outage needs prior interrupted state |
| R3S-08 | W4 | — | core/maintenance.rs:9 | Stale-owner maintenance leaves filters | false-positive explicit administrator maintenance/account removal excluded |
| R3S-09 | W4 | — | bin/service.rs:250 | Repeated SCM stop dispatch hangs | false-positive one-shot atomic reservation and try_send guard |
| R3S-10 | W4 | — | bin/service.rs:492 | SCM runtime drop hangs after timed-out native work | false-positive shutdown_background already prevents it |
| R3S-11 | W4 | — | core/runtime.rs:98 | Unparseable runtime record wedges all Core starts | duplicate #775 quarantine already merged |
| R3S-12 | W4 | — | core/desired.rs:249 | Reboot replays old run intent without user | duplicate BRICK-W1 boot-session guard already merged |
| R3S-13 | W4 | — | core/desired.rs:189 | Retired owner resurrects Core on next restart | false-positive retirement persists desired stopped before owner clear |
| WIN-PREPARE-FAILURE-AI-HOLD | W7 | P1 | core/update.rs:535 | Failed Prepare uses plain release and omits AI hold | real-fixed #1007 (merged; native CI passed); follow-up to #793 |
| WIN-SCM-STOP-AI-HOLD | W4 | P1 | core/server/mod.rs:578 | Automatic armed SCM Stop releases without AI hold | real-fixed #1014 (merged; native CI passed); selective follow-up to #792 |
| WIN-COMMITTED-CLEANUP-RETRY | W7 | P2 | bin/install_service/update_executor.rs:768 | Committed cleanup ignores locked rollback deletion and retires retry task | real-fixed #1017 (merged; native sharing test passed twice) |
| R3S-17 | W7 | — | update_transaction.rs:332 | Lost consume acknowledgement grants a second executor | false-positive durable high-water, incarnation binding and poisoned-write reopen guards |
| R3S-18 | W7 | — | update_transaction.rs:453 | Archive failure clears live update obligation | false-positive archive persistence precedes slot clearing |
| R3S-19 | W7 | — | update_transaction.rs:571 | Restarted successor cannot adopt pending update | false-positive dead successor can rebind to target-identity process |
| R3S-20 | W7 | — | update_transaction.rs:381 | Restarted original App cannot Disconnect pending update | false-positive owner original/target identity accepted independent of incarnation |
| R3S-21 | W7 | — | core/update.rs:461 | Extraction deadlocks acquiring the transaction Store | false-positive parent drops Store before waiting for NSIS |
| R3S-22 | W7 | — | core/update.rs:341 | Another owner can Adopt pending update | false-positive receipt owner key checked before rebind |
| R3S-23 | W7 | — | update_wire.rs:9 | Wire request injects journal proof phase | false-positive request exposes no proof phase and rejects unknown fields |
| R3S-24 | W7 | — | update_transaction.rs:17 | New additive schema fields corrupt old journal | false-positive explicit optional safe-to-drop schema contract; future major refused |
| R3S-25 | W7 | — | update_transaction.rs:324 | Expired update receipt prevents recovery grants | duplicate decision BRICK-W6; explicit protocol expiry |
| R3S-26 | W7 | — | bin/install_service/update_executor.rs:359 | Published target recovery returns before restarting Service | duplicate #858 documented crash-before-restart limitations |
| R3S-27 | W7 | — | bin/install_service/update_executor.rs:558 | SCM recovery configuration error returns with Service stopped | duplicate BRICK-W9 subset; ordinary native trigger unproven |
| R3S-28 | W7 | — | core/update.rs:213 | Signed artifact size addition can overflow | false-positive signed target artifacts capped at 4 GiB |
| R3S-29 | W7 | — | core/update.rs:780 | Ordinary user forges empty replacement plan | false-positive private SYSTEM plan plus target and scratch binding |
| R3S-30 | W7 | — | core/update.rs:158 | Dead manual installer lease authorizes Connect | false-positive exception admits Status only; lifecycle stays fenced |
| R3S-31 | W7 | P2 | core/update/security.rs:735 | Resume recovery wakes unrelated suspended threads | false-positive no concrete malfunction; independent suspension plus executor failure needed |
| R3S-32 | W7 | — | core/update/security.rs:90 | TrustedInstaller default ACL rejects updates | duplicate #352 default ACL fix |
| R3S-33 | W7 | — | bin/install_service/update_executor.rs:262 | Timed-out BFE work hangs installer Runtime drop | duplicate-fixed #776 block_on_abandoning |
| R3S-34 | W7 | — | core/update.rs:464 | Hung extractor causes network loss after Prepare | false-positive Core stop follows extraction; no single-failure outage; extraction stall remains unqualified |
| WIN-PREPARE-COMMITTED-BACKUPS | W7 | P2 | core/update.rs:459 | Later Prepare overwrites a committed attempt before retained backups are cleaned | real-fixed #1025 (merged; all CI passed; native regressions passed twice) |
| R3S-36 | W7 | P3 | core/update.rs:459 | Later Prepare can supersede a failed DisplayVersion retry | false-positive unqualified ordinary trigger; Service and executor registry writes both must fail; no native reproduction |

PRs (all MERGED; merge-commit auto-merge enabled and used):

| PR | Finding | Labels | CI |
|---|---|---|---|
| #1005 | Unverified-startup AI hold | needs-hardware | passed |
| #1007 | Prepare-failure AI hold | needs-hardware | passed |
| #1014 | Automatic Service-stop AI hold | needs-hardware | passed |
| #1017 | Committed-cleanup retry | none | passed |
| #1025 | Prior-committed backup cleanup before Prepare | none | passed |

36 distinct hypotheses: 5 verified fixes, 22 rejected/false-positive hypotheses, 9 known/duplicate items.

Verification: startup regressions failed locally first (0 passed/2 failed), then passed (3 passed); Service-stop regressions baseline1 passed/3 failed, then4 passed. Portable WFP module96 passed, portable installer17 passed, portable journal14 passed. New Windows-only tests could not run locally: GitHub Windows CI passed the Prepare AI regression, all4 Service-stop regressions, the committed sharing-lock regression twice, and all3 prior-committed guard regressions twice. All required CI checks passed for all5 PRs.

Assigned source reading completed. Installed-device crash/reboot/Stop/DNS/WFP/update validation is unavailable on the Linux host and remains for the final hardware batch. No new verified finding remains unfixed. Receipt expiry BRICK-W6 remains an existing decision; native SCM configuration and dual ARP-write failure leads lacked ordinary reproduction.

Operational correction: a wrong PR-number settings command briefly changed #1008. Its label and auto-merge changes were reverted; labels empty and autoMergeRequest null confirmed afterward. No code or branch changes to that PR.

Hunter: GPT-6.1 Sol (Codex CLI)
