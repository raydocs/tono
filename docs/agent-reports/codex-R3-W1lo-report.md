Three verified bugs are fixed and **all three PRs merged through passing CI**. Combined current-main WFP tests: **105 passed, 0 failed**.

References below use audited baselines. `WKS` means `apps/windows/service/src/core/windows_kill_switch.rs`; `SL` and `SFO` mean `selective_layer.rs` and `selective_fail_open.rs` in that directory.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-LIVE-BOOTSTRAP-APP-DEATH | W1 | P0 | WKS:1497 | App death during Connect leaves Bootstrap blocking indefinitely | Fixed in #1021 |
| WIN-DISCONNECT-CRASH-RETRY-RECONNECT | W1 | P2 | WKS:2756 | Old crash-record retry overwrites successful Disconnect intent | Fixed in #1024 |
| WIN-CORRUPT-STARTUP-RELEASE-RETRY | W1 | P2 | WKS:3005 | Failed ownerless startup removal never retries | Fixed in #1029; readback corner remains |
| R3KS1-PENDING-EXPIRY | W1 | P1 | WKS:3489 | Incomplete DIRECT expiry retains Blocked | Real-unfixed: documented boundary excluded by #777/#926 |
| R3KS1-STRICT-WATCHDOG | W1 | Decision | WKS:2965 | Strict recovery releases after 30 unhealthy ticks | Unchanged: decision 027 |
| R3KS1-SELECTIVE-WORKER-HANG | W1 | P2 | SL:281 | Hung native work strands reconciliation | Duplicate: #988 limitation |
| R3KS1-NRPT-BYPASS | W1 | Decision | SFO:36 | Cached answers, DoH and literal IPs bypass suffix hold | Duplicate: accepted SFO-1 limits |
| R3KS1-SELECTIVE-REMOVAL | W1 | — | WKS:1239 | Arm might remove AI hold prematurely | Duplicate: #976 requires successful replacement |
| R3KS1-COMMITTED-DIRECT-EXPIRY | W1 | P0 | WKS:2555 | Committed lease expiry retains Blocked | Duplicate: #777/#926 |
| R3KS1-INTERRUPTED-FIRST-CONNECT | W1 | P0 | WKS:3486 | Interrupted startup omits AI hold | Duplicate: #1005 |
| R3KS1-LATE-SELECTIVE-WORKER | W1 | P1 | SL:74 | Late apply overwrites newer removal | Duplicate: #988 revisioned worker |
| R3KS1-RECOVERY-AI-OMISSION | W1 | P0 | WKS:2786 | Recovery drops secondary AI hold | Duplicate: #974 |
| R3KS1-UNARMED-TOMBSTONE | W1 | — | WKS:2674 | Tombstone error skips later cleanup | False positive: ordinary protected-session trigger unproved |
| R3KS1-COMMAND-VALIDATOR | W1 | — | SFO:177 | Validator permits injected arguments | False positive: fixed generated commands only |
| R3KS1-REVISION-OVERFLOW | W1 | — | SL:46 | Revision increment overflows | False positive: requires approximately 2⁶⁴ requests |
| R3KS1-SELECTIVE-POISON | W1 | — | SL:38 | Poison disables selective recovery | False positive: poison recovery and panic containment |
| R3KS1-TUN-IDENTITY | W1 | — | WKS:202 | Recycled LUID inherits permission | False positive: Core PID/generation gate |
| R3KS1-CACHE-LIVE | W1 | — | WKS:596 | Failed verification appears healthy | False positive: success conjunct required |
| R3KS1-STALE-DIRECT-PORTS | W1 | — | wfp_model.rs:769 | Stale ports grant DIRECT without endpoints | False positive: endpoints also required |
| R3KS1-ARMED-POISON | W1 | — | WKS:511 | Poison breaks Lock or watchdog | False positive: recovered guards |
| R3KS1-TUN-RECREATION | W1 | — | WKS:1936 | Recreated TUN inherits DIRECT | False positive: LUID re-resolution checks |
| R3KS1-DIRECT-REPLAY-PORTS | W1 | — | WKS:2347 | Replay widens approved ports | False positive: original Armed state retained |
| R3KS1-LOCK-PHYSICAL-ALIAS | W1 | — | WKS:2024 | Lock grants permission to Ethernet | False positive: recorded validated alias required |
| R3KS1-PROXY-ROLLBACK | W1 | — | WKS:1613 | Failed replacement creates harmful state divergence | False positive: live rollback; user effect unproved |
| R3KS1-NRPT-COLLATERAL | W1 | — | SFO:75 | Selective hold blocks ordinary domains | False positive: exact suffix allowlist |
| R3KS1-NATIVE-EPOCH | W1 | — | WKS:1070 | Late native return clears successor claim | False positive: exact epoch ownership |
| R3KS1-ENDPOINT-BOUNDS | W1 | — | WKS:779 | Endpoint list creates unbounded transaction | False positive: 256-entry cap |
| R3KS1-RESTORED-PROOF-WINDOW | W1 | — | WKS:415 | Restored intent waits indefinitely without Core | False positive: bounded proof window |
| R3KS1-BOOTSTRAP-UNION | W1 | — | WKS:1471 | Saturated union removes recovery channel | False positive: deliberate priority; outage unproved |

| PR | Status | Auto-merge | Label |
|---|---|---|---|
| [#1021](https://github.com/raydocs/tono/pull/1021) | Merged; CI passed | Merge commit enabled | `needs-hardware` |
| [#1024](https://github.com/raydocs/tono/pull/1024) | Merged; CI passed | Merge commit enabled | `needs-hardware` |
| [#1029](https://github.com/raydocs/tono/pull/1029) | Merged; CI passed | Merge commit enabled | `needs-hardware` |

**29 hypotheses examined; 17 false positives.** Each fix includes regression evidence, findings and changelog fragments.

The assigned production-source pass is complete. Native device acceptance remains unperformed. #1029 conservatively stops retry if unreadable evidence becomes a valid wanted record; that corner remains documented. Lines 3278+ belong to the separate pass.

[Full report and evidence index](/workspace/w1-codex/out/R3-W1lo/report.md).