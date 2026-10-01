# Round 2: Windows App connection layer hunt (2026-10-01)

Hunter: Claude Opus 5.5. Base: origin/main `626b1d74`.

Scope: end-to-end connect, reconnect, switch, quit and sign-out flows with the sing-box default kernel:

- `apps/windows/app/src-tauri/src/tono/connection*`: transaction, stages, monitor, direct, core_select, platform and switch;
- `connection_health.rs`;
- `commands/` (quit, account, restore);
- status publication.

Round 1 (`2026-10-01-claude-reglate-windows.md`) covered the late merges and the Service IPC. Where a flow crossed into the Service, I followed it there: the sing-box replacement handler, `windows_kill_switch` lock/retract/status and `selective_layer`.

Method: I read the code and followed callers and callees across the App and the Service. Locally I ran only `rustfmt --check`. No native cargo, Tauri or network commands ran on this Mac, and there was no hardware run. Severity calibration follows `codex-r4-prompt-RegLate.md`.

## Result

**One new P1, inferred from source (推导).** WIN-SINGBOX-REPLACE-LOCK-RACE: the sing-box DIRECT process replacement locked the tunnel before the new WinTUN adapter existed. It is fixed in #1257 (needs-hardware). Whether a real device loses this race needs hardware; the fix is harmless if it does not.

No new P0. No network cut in non-strict mode and no dropped AI block was found: every failure path I traced releases with the AI hold.

The #1245 leftover is real, but the mechanism is more specific than #1245 stated. It is P2 and fixed in #1253.

## Findings

| ID | Area | Sev | file:line | One line | Verdict |
|---|---|---|---|---|---|
| WIN-SINGBOX-REPLACE-LOCK-RACE | Service sing-box DIRECT replacement | P1 (推导) | `service/src/core/sing_box_direct.rs:57,88,113` | `lock(None)` ran once, right after `start_core` returned at spawn (sing-box has no IPC wait, `manager.rs:1423`). The killed predecessor's not-present row is refused as "did not resolve to a LUID" (`wfp_model.rs:947`), which the App's connect path retries for 50 × 200 ms and the replacement did not. The restore raced the same way, then `release_general_traffic` ran; the monitor reconnected and the next DIRECT replacement repeated it. | fixed in #1257 (auto-merge, needs-hardware) |
| WIN-SINGBOX-DIRECT-LOCKED-PERMIT-MONITOR | App monitor (#1245 leftover) | P2 | `connection_health.rs::kill_switch_unhealthy_for_monitor` | The pre-replacement retraction stores `TUNNEL_PERMIT_RENDERED=false`, then awaits `selective_layer::remove()` (2× `netsh` plus NRPT, 3 s budget) before `ARMED` becomes Blocked (`windows_kill_switch.rs:1374` → `:2301`). Lock-free `status()` reports Locked without the permit for that whole wait. The monitor excused only owned Blocked, so two 2 s ticks could reconnect. | fixed in #1253 (auto-merge, needs-hardware) |
| (issue #1258) | sing-box DIRECT replacement | P2 | `tooling/scripts/sing-box/runtime-template.json` (`cache_file` off); `direct.rs:1684` | The replacement starts with an empty in-memory fake-IP store. Cached fake IPs from the first process then fail ("missing fakeip record") or cross-map to other domains, because allocation restarts at the range start. This lasts until DNS caches expire after every DIRECT Connect. mihomo's in-place reload keeps its pool. | real-unfixed: needs a decision (persisting fake IPs vs. privacy, or applying DIRECT before Connected); issue #1258, needs-hardware |
| R2W-REPLACE-RELEASE-SHOWN-CONNECTED | App DIRECT replacement failure | P3 | `direct.rs:1742-1751`, `1895-1913` | When the Service answers the replacement with "general traffic was released", the App logs "all traffic remains tunneled" and stays Connected until two monitor ticks (about 4 s) see `wanted=false`. | real-unfixed: short and self-correcting; the monitor publishes the kill-switch reading each tick |
| R2W-REPLACE-NO-DATAPLANE-PROOF | App DIRECT replacement | P3 (hypothesis) | `direct.rs:1756-1832` | Connect waits for the TUN route (`wait_for_tun_route_ready`) and proves fake IP and the data plane after locking; the replacement proves only `/rules`, the commit and the Locked digest. A replacement whose routes come up late is caught only by a later network-event probe or the 120 s exit probe. | concern: needs hardware to show it persists; sing-box `auto_route` installs routes during TUN start |
| R2W-REPLACE-DNS-LEG | App monitor | P3 (hypothesis) | `monitor.rs:943-944` | The protected-DNS leg is not excused during an owned reload. If the recreated WinTUN adapter reports a DNS `last_error` for 2 ticks, the monitor reconnects and DIRECT runs again. | unverified: depends on Service DNS reconcile timing; hardware |
| R2W-QUIT-WAITS-REPLACEMENT | Quit/Disconnect | note | `direct.rs:1738` (mutation guard), `disconnect.rs:27` | Quit/Disconnect wait for an in-flight replacement IPC, because the replacement holds the connect-mutation reader. With #1257 the worst case grows by up to about 30 s (three 10 s lock budgets), still under the 55 s explicit-release budget; the normal case adds about 1 s. WM_ENDSESSION keeps its own short budget. | accepted risk, recorded |

## Rejected hypotheses (false positives)

1. **Sign-out fails offline.** `AuthClient::logout` ignores the server result (`let _ = self.logout_identity`). Only the local refresh-token delete can fail it (`crates/tono-core/src/auth.rs:1346`).
2. **Hot switch on sing-box dials the new exit outside `route_exclude_address`.** The template sets `route.auto_detect_interface: true`, so outbound dials bind to the physical NIC, and the hot switch widens WFP to the union before it moves the selector (`switch.rs:250-262`). The `Tono-Exit` selector tag matches `EXIT_GROUP_NAME`.
3. **The DIRECT replacement drops `CatalogRouting.default_proxy`.** The sing-box runtime never reads `default_proxy` (`sing_box/runtime.rs` uses only `home_proxy`/`home_socks5`).
4. **The replacement reopens the fresh-arm proof window and the Service retires the session.** The window opens only at arm (`note_fresh_arm_core_window`), not in `start_core`.
5. **A second Locked-without-permit window in `start_core`'s own retraction.** `stop_core` has already published Blocked, so that render stays Blocked. Only the first retraction has the window (fixed in #1253).
6. **`lock()` after the replacement binds a stale ghost LUID.** `validate_tunnel_luid` refuses a not-present row. A row that still reads Down could be accepted, but it is the same interface row the new device revives (WIN-GATE-GHOST-TUN). Not a confirmed defect.
7. **Monitor counts a Core pid change during the replacement as a crash.** Fixed by #1245 (`core_identity_change_owned` plus baseline adoption); re-read on main, it holds.

Hypotheses examined: 14. Fixed: 2. Issue: 1. Open notes: 4. False positives: 7.

## PRs and issues

- #1253: monitor exemption. needs-hardware, auto-merge set.
- #1257: replacement lock retry. needs-hardware, auto-merge set.
- #1258: fake-IP store loss. Issue, needs-hardware; needs a product/privacy decision.

## Not finished

- `commands/restore.rs` startup resume and `reconnect.rs` backoff were read only along the sing-box paths above, not end to end.
- `unarmed_probe.rs`, `probes.rs` and the tray menu wiring were not read.
- Nothing ran on hardware. Every verdict on adapter, route or DNS timing is inferred from source.
