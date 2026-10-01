# R3-W1lo: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:33 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| WIN-LIVE-BOOTSTRAP-APP-DEATH | W1 | P0 | windows_kill_switch.rs:1497 | App death during first Connect leaves a healthy Bootstrap block forever | real-fixed awaiting PR |
| R3KS1-PENDING-EXPIRY | W1 | P1 | windows_kill_switch.rs:3489 | Uncommitted DIRECT expiry retains healthy Blocked | duplicate #777/#926 deliberately excluded; decision item |
| R3KS1-STRICT-WATCHDOG | W1 | decision | windows_kill_switch.rs:2965 | Strict watchdog releases after 30 unhealthy ticks | real-unfixed documented decision 027; preserve existing behavior |
| R3KS1-UNARMED-TOMBSTONE | W1 | P2 | windows_kill_switch.rs:2674 | Unarmed release skips DNS and hold after tombstone failure | false-positive P0/P1 claim requires recovery trigger plus disk-write failure; known #769 limitation |
| R3KS1-SELECTIVE-WORKER-HANG | W1 | P2 | selective_layer.rs:281 | Hung native child can strand future selective operations | duplicate #988 native-failure limitation; bounded async waits |
| R3KS1-NRPT-BYPASS | W1 | decision | selective_fail_open.rs:36 | Cached answers DoH literal IPs bypass suffix hold | duplicate SFO-1 accepted design |
| R3KS1-COMMAND-VALIDATOR | W1 | — | selective_fail_open.rs:177 | Command safety predicate permits extra malicious arguments | false-positive only fixed generated vectors reach caller |
| R3KS1-REVISION-OVERFLOW | W1 | — | selective_layer.rs:46 | Revision increment could panic on overflow | false-positive requires about 2^64 requests |
| R3KS1-SELECTIVE-POISON | W1 | — | selective_layer.rs:38 | Poisoned worker mutex may freeze future hold requests | false-positive poison guards recover; unwind worker resets running |
| R3KS1-TUN-IDENTITY | W1 | — | windows_kill_switch.rs:202 | Recycled LUID could inherit broad tunnel permission | false-positive Core PID plus generation scopes tunnel grant |
| R3KS1-SELECTIVE-REMOVAL | W1 | — | windows_kill_switch.rs:1239 | Arming removes the hold before replacement protection exists | false-positive remove follows successful exact WFP install |
| R3KS1-CACHE-LIVE | W1 | — | windows_kill_switch.rs:596 | Live cache reports failed verify as healthy | false-positive ok conjunct rejects failed verification; five-second cache deliberate |
| R3KS1-CORRUPT-RELEASE-RETRY | W1 | P2 | windows_kill_switch.rs:2985 | Corrupt or unreadable startup plus transient WFP removal failure has no retry | real-unfixed two independent failures; deferred for P0 delivery |
| R3KS1-TOMBSTONE-PENDING | W1 | P2 | windows_kill_switch.rs:2816 | Pending crash tombstone can overwrite explicit Disconnect reconnect=false | real-unfixed crash recovery plus transient disk failure; under review for narrow fix |
