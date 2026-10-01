# R3-W4W7: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:05 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1005 | hunt/sol-r3svc-unverified-recovery-ai-hold | needs-hardware | yes | fix(windows): retain AI blocking after interrupted first connection |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R3S-01 | W4 | P1 | core/windows_kill_switch.rs:3410 | Unverified startup crash cleanup releases without secondary AI hold | real-fixed #1005 (CI pending) |
| R3S-02 | W4 | — | core/windows_kill_switch.rs:2819 | Verified startup reconciliation failure leaves block forever | false-positive independent 30-second wanted-Core deadline |
| R3S-03 | W4 | P2 | core/windows_kill_switch.rs:3360 | Unverified reconciliation error retains block | real-unfixed not new: interrupted attempt plus independent reconcile error; no ordinary single-failure proof |
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
| R3S-14 | W7 | P1 | core/update.rs:535 | Failed Prepare uses plain release and omits AI hold | real-unfixed regression in progress; follow-up to #793 |
