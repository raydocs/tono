# Round 4 — Windows Service IPC, update apply, multi-user (Claude, 2026-10-01)

Baseline: main `509ebde2`. Read-only review plus one fix. Nothing was built or run on this Mac; native checks run in hosted CI only.

## Scope
1. **Service IPC authentication and authorization:**
   - Named-pipe DACL: `IU` read/write, deny `NU`, no `FILE_CREATE_PIPE_INSTANCE` for users.
   - Owner authentication: kernel peer PID → token SID, before the caller-chosen filesystem evidence.
   - The installed-App image gate.
   - Which routes another user can reach.
   - The App-side server check: `verify_registered_service_process_id`, with pooling disabled whenever verification is on.
2. **Service-side update apply:** manifest signature, sequence replay, staging and executor copy, payload component check, swap and rollback, and WFP state after a failed apply.
3. **Multi-user and fast user switching:** A connected, B launches Tono; A signs out; both Apps running.

## Findings

| ID | Sev | Where | Verdict | Action |
|---|---|---|---|---|
| R4-WIN-UPDATE-NEW-MEMBER | P2 | `core/update.rs` Prepare (component check only); `bin/install_service/update_executor.rs` `collect_candidates` | Confirmed (reading) | Fixed: [#1289](https://github.com/raydocs/tono/pull/1289), `needs-hardware`, not auto-merged |
| R4-WIN-MU-RESTORE-FOLD | P2 | `app/src-tauri/src/tono/commands/restore.rs:44-55, 88-99`; `quit.rs:573-584` | Confirmed (reading) | [#1290](https://github.com/raydocs/tono/issues/1290): owner decision (B's display; needs Service-side "owned by caller") |
| R4-WIN-MU-RECONNECT-FLAG | P2 | `service/src/core/windows_kill_switch.rs:3148, 4392-4394`; `restore.rs:295-312`; `connection/monitor.rs:704-740` | Paths confirmed; race inferred | [#1291](https://github.com/raydocs/tono/issues/1291) |
| R4-WIN-UPDATE-RECOVERY-LOOP | P2 | `update_executor.rs` ~375-397, ~605, ~636-675; `core/update.rs` `reconcile_before_desired` | Steps confirmed; loop inferred | [#1292](https://github.com/raydocs/tono/issues/1292) |
| six P3 items | P3 | see issue | Inferred | [#1293](https://github.com/raydocs/tono/issues/1293) roll-up |

No P0 or P1 found. In particular, the following were checked and found sound:
- No unsigned or user-writable binary is executed as SYSTEM. Covered: the package copy is digest-bound to the signed manifest inside a private DACL, the executor is copied from the ACL-verified install tree, and the core path is allowlisted and digest-pinned.
- No route lets another user release, stop or reconfigure an armed session it does not own (`authorize_write_for` / `authorize_takeover_for` / active-session gates).
- The legacy SYSTEM delete walk over the caller's AppData root opens with `OPEN_REPARSE_POINT`, checks the final path is under the root, and deletes by handle.
- The App refuses a squatted pipe server.

## Fix detail (#1289)
- **Problem:** a signed payload that adds a file or directory other than `sing-box.exe` / `sing-box-sha256.txt` passed Prepare. The executor refused it only after it had:
  - consumed the release sequence,
  - stopped the Service,
  - terminated the App.

  The App was not relaunched, and a native retry of the same release is refused as a replay.
- **Change:** Prepare now applies the executor's rule (`ensure_payload_publishable`) before `Staged` and before Core is stopped. A refusal takes the same exit as a component mismatch, so the network is untouched and no sequence is consumed. The executor reuses the library's sing-box rule.
- **Test:** `prepare_refuses_a_payload_member_the_executor_cannot_publish` (Windows CI).

## Open risks
- All four P2s and the P3s need Windows hardware with two accounts (or a fault-injected rollback) to confirm.
- #1290 and #1291 touch status semantics across users, so they need an owner decision before code.
- Item 4 of #1293 asks whether decision 031 intends the AI hold to be installed for a user who was Unprotected before a failed update.
