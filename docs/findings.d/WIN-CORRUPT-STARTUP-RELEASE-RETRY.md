| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORRUPT-STARTUP-RELEASE-RETRY | Startup with unusable non-strict intent abandons stale WFP removal after a transient native failure, leaving no in-memory watchdog owner | fixed(f7d82d30) | Branch `hunt/sol-r3ks1-corrupt-release-retry` (this PR) | 低·已确认（P2，Linux 回归） | Requires unusable/unreadable intent plus an independent native removal failure. Native Windows networking untested. A record that later becomes readable valid wanted intent still terminates retry conservatively. |

Baseline `262b1864`: corrupt, unreadable, invalid non-strict or missing-with-residual startup calls `release_general_traffic_unlocked` (`windows_kill_switch.rs:3005`, `:3246–3303`). Removal failure returns with `ARMED=None`; the watchdog has no session to reconcile. The existing startup retry (`:483`) is scheduled only for parseable wanted:false records (`:3210`). Clearing the native error alone does not clear the persistent block.

The new startup wrapper schedules that same serialized/backoff retry after failed ownerless release. A retry keeps corrupt evidence and applies the same narrow AI hold after removing broad filters. A newer ARMED state, valid wanted record or explicit strict record stops the worker. The existing wanted:false reconnect-tombstone and AI disposition stay unchanged.

`corrupt_startup_removal_failure_retries_and_keeps_evidence_and_ai_hold` first failed after the simulated removal error cleared, then passed with residual keys removed, exact evidence retained and AI hold active. `corrupt_startup_release_retry_preserves_a_new_unusable_strict_record` verifies strict successor evidence prevents removal. #753's wanted:false retry and #974's initial AI hold are adjacent, distinct fixes.
