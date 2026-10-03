| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SINGBOX-REPLACE-LOCK-RACE | The Service's sing-box DIRECT process replacement locks the tunnel once, immediately after spawning sing-box and before its WinTUN adapter exists, so the lock is refused as "did not resolve to a LUID", the restore races the same way, and general traffic is released; the monitor then reconnects and the next DIRECT replacement repeats it | fixed(9b82d8ff) | hunt/claude-r2-win-singbox-lock-retry | 中·推导（P1 if the race holds on hardware; source and regression） | Whether a real device ever wins the race (the ghost row could still read Down, not NotPresent) needs hardware; the fix is harmless if it does |

Source: `sing_box_direct.rs` called `windows_kill_switch::lock(None)` right after `start_core`, which returns at spawn for
sing-box (`core_serves_ipc_pipe` is false, so there is no IPC wait). WIN-GATE-GHOST-TUN documents that a killed Core leaves a
not-present `Tono` row; `validate_tunnel_luid` refuses it with "did not resolve to a LUID", the refusal the App's connect path
retries for up to 50 × 200 ms (`lock_kill_switch_with_retries`). The replacement had no retry, so the failure path ran
`restore_or_release` → `release_general_traffic` (Core stopped, WFP released, AI hold applied). Not a cut, but the session
could not stay connected while a DIRECT policy applied. The fix retries only those adapter-not-ready refusals with the App's
budget; every other lock failure still takes the existing restore/release path.
