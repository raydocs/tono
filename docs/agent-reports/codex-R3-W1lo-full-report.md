# R3-W1lo Windows WFP hunt — 2026-09-30

Hunter: GPT-6.1 Sol (Codex CLI)

Assigned production pass completed: windows_kill_switch.rs first ~3278 original lines; full selective_fail_open.rs and selective_layer.rs; relevant App, owner lifecycle, desired/Core supervision, WFP model/backend and native selective-DNS callers. Later watchdog paths were followed to verify first-half state and known boundaries; their separate earlier audit was not duplicated.

| ID | Area | Severity | File:line (audited baseline) | Description | Verdict |
|---|---|---|---|---|---|
| WIN-LIVE-BOOTSTRAP-APP-DEATH | W1 | P0 | windows_kill_switch.rs:1497 | App death during first Connect leaves a healthy Bootstrap block forever | real-fixed #1021 |
| R3KS1-PENDING-EXPIRY | W1 | P1 | windows_kill_switch.rs:3489 | Uncommitted DIRECT expiry retains healthy Blocked | real-unfixed decision boundary; #777/#926 deliberately exclude incomplete phases |
| R3KS1-STRICT-WATCHDOG | W1 | decision | windows_kill_switch.rs:2965 | Strict watchdog releases after 30 unhealthy ticks | real-unfixed documented decision 027; preserve existing behavior |
| R3KS1-UNARMED-TOMBSTONE | W1 | P2 | windows_kill_switch.rs:2674 | Unarmed release skips DNS and hold after tombstone failure | false-positive P0/P1 claim requires recovery trigger plus disk-write failure; known #769 limitation |
| R3KS1-SELECTIVE-WORKER-HANG | W1 | P2 | selective_layer.rs:281 | Hung native child can strand future selective operations | duplicate #988 native-failure limitation; bounded async waits |
| R3KS1-NRPT-BYPASS | W1 | decision | selective_fail_open.rs:36 | Cached answers DoH literal IPs bypass suffix hold | duplicate SFO-1 accepted design |
| R3KS1-COMMAND-VALIDATOR | W1 | — | selective_fail_open.rs:177 | Command safety predicate permits extra malicious arguments | false-positive only fixed generated vectors reach caller |
| R3KS1-REVISION-OVERFLOW | W1 | — | selective_layer.rs:46 | Revision increment could panic on overflow | false-positive requires about 2^64 requests |
| R3KS1-SELECTIVE-POISON | W1 | — | selective_layer.rs:38 | Poisoned worker mutex may freeze future hold requests | false-positive poison guards recover; unwind worker resets running |
| R3KS1-TUN-IDENTITY | W1 | — | windows_kill_switch.rs:202 | Recycled LUID could inherit broad tunnel permission | false-positive Core PID plus generation scopes tunnel grant |
| R3KS1-SELECTIVE-REMOVAL | W1 | — | windows_kill_switch.rs:1239 | Arming removes the hold before replacement protection exists | duplicate #976; removal follows successful exact replacement |
| R3KS1-CACHE-LIVE | W1 | — | windows_kill_switch.rs:596 | Live cache reports failed verify as healthy | false-positive ok conjunct rejects failed verification; five-second cache deliberate |
| WIN-CORRUPT-STARTUP-RELEASE-RETRY | W1 | P2 | windows_kill_switch.rs:3005 | Ownerless corrupt startup abandons broad-filter removal after transient native failure | real-fixed #1029; recovered valid-wanted readback remains a conservative-admission limitation |
| WIN-DISCONNECT-CRASH-RETRY-RECONNECT | W1 | P2 | windows_kill_switch.rs:2756 | Pending crash tombstone overwrites a successful Disconnect durable reconnect=false | real-fixed #1024 |
| R3KS1-STALE-DIRECT-PORTS | W1 | — | wfp_model.rs:769 | Stale reviewed-port declaration grants DIRECT without a plan | false-positive rule also requires Locked tunnel and nonempty endpoints |
| R3KS1-ARMED-POISON | W1 | — | windows_kill_switch.rs:511 | Poisoned ARMED mutex breaks Lock verification or watchdog | false-positive armed_guard recovers PoisonError |
| R3KS1-TUN-RECREATION | W1 | — | windows_kill_switch.rs:1936 | Same-process WinTUN recreation inherits old DIRECT permit | false-positive native LUID is re-resolved and checked before and after publication |
| R3KS1-DIRECT-REPLAY-PORTS | W1 | — | windows_kill_switch.rs:2347 | Idempotent endpoint replay widens reviewed ports | false-positive replay reinstalls original Armed state and ignores supplied ports |
| R3KS1-LOCK-PHYSICAL-ALIAS | W1 | — | windows_kill_switch.rs:2024 | Lock can grant broad permission to Ethernet by supplied alias | false-positive supplied alias must equal staged validated tunnel alias |
| R3KS1-PROXY-ROLLBACK | W1 | — | windows_kill_switch.rs:1613 | Failed proxy replacement leaves exploitable durable/live split | false-positive rollback restores old live state; stale disk needs two failures and no user effect proved |
| R3KS1-COMMITTED-DIRECT-EXPIRY | W1 | P0 | windows_kill_switch.rs:2555 | App death or renewal failure leaves committed DIRECT Blocked | duplicate #777/#926 |
| R3KS1-INTERRUPTED-FIRST-CONNECT | W1 | P0 | windows_kill_switch.rs:3486 | Service restart after interrupted first Connect omits AI hold | duplicate #1005 |
| R3KS1-NRPT-COLLATERAL | W1 | — | selective_fail_open.rs:75 | Selective NRPT hold blocks ordinary or LAN domains | false-positive exact first-party suffix allowlist and separate GUIDs exclude catch-all |
| R3KS1-LATE-SELECTIVE-WORKER | W1 | P1 | selective_layer.rs:74 | Late selective apply overwrites a newer remove request | duplicate #988 revisioned single-worker reconciliation |
| R3KS1-RECOVERY-AI-OMISSION | W1 | P0 | windows_kill_switch.rs:2786 | Corrupt or unproven-session recovery drops secondary AI hold | duplicate #974 |
| R3KS1-NATIVE-EPOCH | W1 | — | windows_kill_switch.rs:1070 | Late native engine return clears a newer operation claim | false-positive claim drops on worker return and only clears its own epoch |
| R3KS1-ENDPOINT-BOUNDS | W1 | — | windows_kill_switch.rs:779 | Oversized proxy plan creates an unbounded WFP transaction | false-positive arm and replacement enforce a 256-entry bound |
| R3KS1-RESTORED-PROOF-WINDOW | W1 | — | windows_kill_switch.rs:415 | Restored verified session waits forever without a Core | false-positive separate restored proof deadline bounds non-strict recovery |
| R3KS1-BOOTSTRAP-UNION | W1 | — | windows_kill_switch.rs:1471 | Saturated bootstrap union provably removes the recovery channel | false-positive first-wins priority is deliberate and compiled pins stay prioritized; no outage proved |

Hypotheses: 29. False positives: 17. Verified new fixes: 3. Duplicates/known limitations: 7. Documented decision boundaries: 2.

PRs:

- [#1021](https://github.com/raydocs/tono/pull/1021): merged with merge commit a191bc64e2d20ccf9dae67790f3b0d6744cfbca3; needs-hardware; MERGE auto-merge enabled before merge. Linux WFP98/98 plus owner lifecycle12/12; hosted Windows CI passed.
- [#1024](https://github.com/raydocs/tono/pull/1024): merged with merge commit 92260464b49609d0132e65824612c47ab4eab1e3; needs-hardware; MERGE auto-merge enabled before merge. Linux WFP95/95; hosted Windows CI passed.
- [#1029](https://github.com/raydocs/tono/pull/1029): merged with merge commit f7d82d30526a7d4acf445ed075e577ff2f996101; needs-hardware; MERGE auto-merge enabled before merge. Linux final rebased WFP104/104; all applicable hosted Windows checks and ci-gate passed.

Each PR contains a narrow failing-then-passing regression plus any necessary guard regression, one findings fragment and one changelog fragment. No deploy, publication, device networking changes, skipped tests, CI-gate changes or edits to others’ branches.

Remaining limitations:

- Native installed Windows Service/TUN/WFP/DNS/device behavior could not be exercised in this Linux VM. Hosted Windows compile/tests are distinct from hardware acceptance.
- #1029 still stops retry when previously unreadable bytes become readable valid wanted intent; that conservative wanted admission remains unchanged.
- Incomplete DIRECT Bracket/Pending expiry and strict 30-unhealthy-tick behavior were retained as documented decision boundaries.
- No assigned production file remained unread. Windows_kill_switch.rs lines3278+ was owned by another pass; only relevant callers/watchdog paths were followed here.

Evidence: raw failing/passing logs and PR body/dedupe/CI snapshots in this output directory; incremental findings.tsv and prs.tsv are authoritative operator checkpoints.

Combined-current-main verification: fetched origin/main at f7d82d30526a7d4acf445ed075e577ff2f996101 onto local read-only verification branch hunt/sol-r3ks1-final-verify. Same narrow Linux WFP command: 105 passed, 0 failed (final-main-wfp.log). Both prior merge commits are ancestors; checkout clean. No verification edits or empty commits were created.
