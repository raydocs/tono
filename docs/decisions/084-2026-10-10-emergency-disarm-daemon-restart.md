## 2026-10-10 · macOS `--emergency-disarm`: operator release wins, as one persisted target state
- Status: owner-approved design (owner via Puck 2026-10-10: redesign authorised, including the helper protocol change;
  course correction to reuse the existing target state and session generation instead of a second latch). Implemented
  by the backlog A13 agent; the owner may revisit.
- Chosen:
  - **One persisted target, one monotonic generation.** The helper's existing state is `killswitch.state` (what PF
    should hold now; absent = disconnected) plus the in-memory `stateGeneration` that lets a newer protection change
    supersede an arm still in flight. Neither survives a restart as "an administrator released this Mac", and the app
    and helper are separate processes (Mullvad's daemon is one actor), so the single addition is
    `/Library/Application Support/Tono/target-state`: `secured <n>` or `released <n>`. No file = no release or session
    was ever recorded, behavior as before. Mapping to Mullvad (`target_state.rs`, read for comparison only): `secured`
    = Secured, `released` = the explicit Disconnected target an administrator set; Mullvad's "unreadable = Secured"
    (fail closed) maps here, for the operator-release case, to **unreadable = refuse every automatic re-arm (stay
    released) with an explicit `TARGET_STATE_UNREADABLE` error while cleanup goes on**. Proton clears its persisted
    target before stopping the tunnel; Tono likewise latches before the bootout.
  - **`--emergency-disarm` order, every phase bounded:** `released` in memory first (`HelperTarget.processOverride`),
    its write started beside everything else (under the target lock, generation = old + 1; an unreadable old record
    is replaced in one rename) → bounded bootout (20 s; every launchctl call, spawn included, on its own thread, abandoned at
    deadline + 2.5 s) → the release as independent steps, each on its own thread with its own budget: **PF first**
    (emergency-only, idempotent `pfctl -a tono.killswitch -F all`: Tono's anchor only, never the main ruleset, no
    System Configuration, update store or disk needed; 15 s), then DNS restore (20 s), then AI-layer removal (15 s),
    then the full existing release for the stale Core and the update ledger (45 s; update lock 5 s, then update
    cleanup is skipped; every child 15 s: TERM, KILL, abandon) → bounded readback (20 s) → a bounded re-read of the
    target (2 s) → the daemon is bootstrapped again (10 s) **only when this command's `released` generation is what is
    on disk**, so it comes back refusing every arm while its start and 10 s watchdog keep releasing a leftover block,
    retrying DNS and AI-layer removal. A write that fails, misses its 3 s budget, or was replaced by a later Connect
    leaves the daemon stopped (nothing can restart unaware of the release) and prints an error. After the first
    readback the CLI settles: a 1 s gap, a second readback, and if anything reappeared or stayed (a helper or update
    executor that survived the bootout), the PF / DNS / AI steps once more and a third readback; claims rest on the
    final one. Command ceiling: 181.5 s. Exit 0 only when the release finished, all four components read back
    restored and the release is confirmed on disk.
  - **Every irreversible effect is guarded on both sides** (`HelperTarget.guardedEffect` / `stepsUnlessReleased`): PF
    loads (arm commit, supervision repair, permit withholding, LAN widening, power barrier, emergency block: all
    through one gate inside `ensureAnchorLoaded`), each 127.0.0.1 DNS write, each AI resolver file and route, and the
    owner app relaunch (right before `Process.run()` and right after it returns) read the target right before and
    right after; a release in between undoes the effect and stops. The read after also runs when the effect threw,
    since it may have committed first. The undo uses what was captured before the effect (the DNS originals), never
    a re-read that the release's own cleanup may have removed. A released daemon also releases a block it reads in
    Tono's anchor without saved intent. No lock is held across PF, System Configuration or disk I/O.
  - **Repairing an unreadable target never leaves it missing:** the replacement is written beside it first, then one
    `rename(2)` puts it over the unreadable record (kept as `.invalid-` evidence by a hard link); only a directory in
    its place is moved aside first, and a record missing beside `.invalid-` / `.staged-` leftovers reads as
    unreadable, never as missing (round 5 F3, round 6 R5-F2).
  - **Every helper child passes #1542's admission gate**, the Core included: the shell runs the command only after
    `go`, written once the launch is accepted inside its deadline; an abandoned launch never executes. Input a
    command needs (the install guard's script) follows `go` on the same pipe (round 6, R5-F1).
  - **Every helper child and the update lock are bounded**, not only in `--emergency-disarm` (owner requirement,
    round 5): launchctl 60 s, ditto 600 s, the relaunch / successor `open` 60 s, the install guard's script 600 s,
    the Core's launch 10 s and config check 5 s, a staged helper's `--version` 10 s, pfctl and networksetup 15 s,
    all through `KillSwitchManager.run` (deadline from before the launch); the update lock 660 s, then
    `UPDATE_LOCK_TIMEOUT`.
  - **Readback per component** (PF broad block in `tono.killswitch`, DNS, AI sinkhole resolvers, AI blackhole routes):
    restored / NOT restored (with the residue named) / unknown. A failed query is unknown, never restored.
  - **While `released` or unreadable** the helper refuses `/killswitch/arm` (all callers, the update path's included),
    `/core/start`, `/core/sync`, `/dns/enable`, PF supervision re-arm, the reviewed-bundle permit reload, the power
    barrier and the dead-owner app relaunch, each checked again where it acts (arm commit, Core launch, the DNS
    write, inside supervision and the permit reload), not only at the request. The AI hold is a full release too:
    automatic releases do not keep it, `applyBestEffort` never reinstalls it, and the startup and watchdog
    reconciliation remove sinkholes and blackhole routes every pass until the system reads them gone. A saved block
    is released at once (no Core-start threshold), DNS is restored even beside a Core that survived. Releases,
    status, `/dns/restore`, `/core/stop` stay allowed.
  - **Only an explicit user Connect ends it:** the app's user Connect / Retry buttons (`AppState.connectFromUser`,
    `retryProtectedConnectionNow(userInitiated:)`) mint a single-use intent bound to the attempt they start (10 s,
    consumed only by that attempt's perform step; an observed release or Restore Internet drops it). That attempt
    reads `GET /session` and sends `POST /session/connect {expectedGeneration}`: compare-and-swap under the same
    target lock the CLI takes, so a release written after the read wins (`SESSION_SUPERSEDED`). The helper writes
    `secured <n+1>`, which every later arm carries as `sessionGeneration`; an older generation is refused, so old
    in-flight requests, heals and automatic reconnects of the earlier session never apply and never clear the
    release. Arms without a generation (a relaunched app, helper internal) pass only when no release holds. Server
    picks and the Support remote retry do not begin a session. The Connect also repairs a target record that is
    not a private root-owned regular file with valid content (replaced, the old one kept as evidence); a target it cannot write
    fails the Connect with `TARGET_STATE_UNWRITABLE` and a concrete message.
  - **No one-time token.** The helper cannot tell a user Connect from an automatic one either way: both arrive over the
    same authenticated peer channel. The distinction is the app calling `/session/connect` only from the user's
    action, which is exactly what a token request would also depend on; the generation already refuses older
    sessions' requests. A token would add a second state without adding a guarantee.
  - Rejected: a separate permanent latch state machine (owner course correction); always restarting the daemon
    unlatched (second writer, re-arm against operator intent: re-review R1); never restarting it (no cleanup owner:
    re-review R2).
- Why stricter: an operator release can no longer be undone by anything automatic, including a helper restart; the
  escape hatch never waits without limit or fails closed on launchd, the update lock, a child process or the disk;
  success is never claimed on an unread component.
- Applied in: [#1504](https://github.com/raydocs/tono/pull/1504) (backlog A13, helper 4.52.50).
