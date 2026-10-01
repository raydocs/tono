# Round 5 — Windows App quit, restore, reconnect, probes, tray, startup (Claude, 2026-10-01)

Baseline: main `4bb0ba4a`. Read-only review plus one fix. Nothing was built or run on this Mac; native checks run in hosted CI only.

## Scope
`apps/windows/app/src-tauri/src/tono/`:
- `commands/quit.rs`, `commands/restore.rs`
- `connection/reconnect.rs`, `connection/unarmed_probe.rs`, `connection/probes.rs`
- the release paths these call (`connection/disconnect.rs`, `connection/heal.rs`, the `monitor.rs` Protected Offline poll)

Also:
- Tray wiring: `core/tray/mod.rs`, `core/tray/flyout.rs`, and the `feat/window.rs` quit/restart flow.
- App startup after a crash or reboot when the Service reports a leftover barrier, does not answer, or is stopped.

Recorded findings and the open issues #1290 #1291 #1292 #1293 #1258 #1055 #1284 were skipped.

## Findings

| ID | Sev | Where | Verdict | Action |
|---|---|---|---|---|
| R5-WIN-TRAY-CANCELLED-QUIT-RESYNC | P2 | `core/tray/mod.rs:757`, `core/tray/flyout.rs:185` | Confirmed (reading) | Fixed: [#1299](https://github.com/raydocs/tono/pull/1299) |
| R5-WIN-RELAUNCH-STOPPED-SERVICE-UNKNOWN | P2 | `commands/restore.rs:41-97`; `commands/quit.rs:322-331`; `connection/disconnect.rs:298` | Confirmed (reading) | [#1300](https://github.com/raydocs/tono/issues/1300): owner decision |

No P0 or P1 found.

### R5-WIN-TRAY-CANCELLED-QUIT-RESYNC (#1299)
- **Problem:** On Windows the tray is the main Quit entry, because closing the window only hides it. Tray menu Exit and the tray flyout Quit called `feat::quit()` and dropped its `ShutdownOutcome`.
- **Effect after "stay open" (or a failed Core stop):** `resync_after_cancelled_quit` never ran.
  - The catalog/policy periodic sync that `quit_release` retired stayed stopped.
  - The Service reading was not folded back.
  - This is the WIN-CANCELLED-QUIT-STOPS-CATALOG-SYNC effect. #784 fixed it only for the window close request and Restart.
- **Change:** one shared `feat::quit_or_resync()`, used by all three entries. Release, refusal dialog and budgets are unchanged.
- **Test:** `a_cancelled_quit_resyncs_the_app_that_stays_open`.
- **Merge:** not auto-merged. It is on the quit lifecycle path, so the main session decides.

### R5-WIN-RELAUNCH-STOPPED-SERVICE-UNKNOWN (#1300)
- **Trigger:** the user quits while not connected, so the Service stops itself through owner-goodbye. The user then relaunches without rebooting.
- **Startup:** the startup probe gets no answer and reads `Unknown`, which is recorded as armed.
  - The UI shows protection unknown / Protected Offline. Connect is hidden.
  - The 30 s Service poll can never clear it, because the Service is stopped.
- **Next Quit:** it takes the explicit release, which starts the stopped Service, so the user gets a UAC prompt.
- **Not affected:** the network is not cut and nothing leaks.
- **Not fixed here:** `Unknown → armed` is a deliberate fail-safe. A PERSISTENT WFP floor means a stopped Service does not prove that no barrier exists. The options are listed in the issue.

## Checked and found sound
- **Reconnect loop (`reconnect.rs`):**
  - The loop is bounded by the 30-minute ladder budget. Explicit Retry resets that budget.
  - Admission, abort and replacement happen under one lock. Every rung re-checks the generation.
  - A transient guard rejection takes the next rung; it does not spin.
  - The Protected Offline poll is one status IPC every 30 s and exits when the state is left.
  - No path hammers the Service.
- **Unarmed probe (`unarmed_probe.rs`):**
  - It TCP-probes only after a release, and connects only after `barrier_is_down` under the current generation.
  - Disconnect, Quit, Restore and sign-out retire it through the generation bump and `abort_connection_tasks`.
  - Native network reads are capped at one in flight per process.
- **Probes (`probes.rs`):**
  - Post-lock verification first requires `wanted && live && Locked`, then a WinTUN data-plane probe. With WFP locked, physical egress is blocked, so a probe cannot leave outside the tunnel while Protected.
  - The loopback mixed-proxy probe is diagnostic only.
  - The `/delay` probe goes through the authenticated controller.
- **Restore (`commands/restore.rs`):**
  - The protection probe has three values: armed, proven absent, unknown. Unknown never releases.
  - A 401 suspends and keeps protection and the stored session.
  - The no-token path releases only a barrier the Service reported armed. A proven-absent reading with a retained AI hold is not touched.
  - Crash-window reconnect requires the Service's `reconnect_after_release` and a Ready account.
- **Quit (`commands/quit.rs`):**
  - The protected predicate is shared between release and service stop.
  - A quit before discovery releases this owner's Service protection.
  - An old cancelled-quit reading cannot overwrite a successor.
  - Owner-goodbye is skipped unless the desired state proves Core stopped.
- **Tray:**
  - Protected Offline without a live Service barrier is labelled "protection unknown", not "protected".
  - Connect is hidden while blocked. Restore internet stays available.

## Open risks
- The real tray click and the cancelled-quit resync were not exercised on Windows hardware.
- #1300 needs an owner decision before code. The recommended option adds a Service-side clean-goodbye marker, which is a protocol bump.
