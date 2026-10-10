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
    its write started beside everything else (generation = old + 1; an unreadable old record restarts from the
    clock) → bounded bootout (20 s) → bounded release (60 s; update lock 5 s, then update cleanup is skipped and the
    network released without the ledger; every child 15 s: TERM, KILL, abandon) → bounded readback (20 s) → the daemon
    is bootstrapped again (10 s) **only once `released` is on disk**, so it comes back refusing every arm while its
    start and 10 s watchdog keep releasing a leftover block, retrying DNS and AI-layer removal. A write that fails or
    misses its 3 s budget leaves the daemon stopped (nothing can restart unaware of the release) and prints an error.
    Command ceiling: 115 s. Exit 0 only when the release finished, all four components read back restored and the
    release is on disk.
  - **Readback per component** (PF broad block in `tono.killswitch`, DNS, AI sinkhole resolvers, AI blackhole routes):
    restored / NOT restored (with the residue named) / unknown. A failed query is unknown, never restored.
  - **While `released` or unreadable** the helper refuses `/killswitch/arm` (all callers, the update path's included),
    `/core/start`, `/core/sync`, `/dns/enable`, PF supervision re-arm, the power barrier and the dead-owner app
    relaunch. Releases, status, `/dns/restore`, `/core/stop` stay allowed.
  - **Only an explicit user Connect ends it:** the app sends `POST /session/connect` from its user Connect / Retry
    buttons only (`AppState.connectFromUser`, `retryProtectedConnectionNow(userInitiated:)`); the helper writes
    `secured <n+1>` and returns n+1, which every later arm carries as `sessionGeneration`. An arm carrying an older
    generation is refused (`SESSION_SUPERSEDED`), so old in-flight requests, heals and automatic reconnects of the
    earlier session never apply and never clear the release. Arms without a generation (a relaunched app, helper
    internal) pass only when no release holds. Server picks and the Support remote retry do not begin a session.
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
- Applied in: [#1504](https://github.com/raydocs/tono/pull/1504) (backlog A13, helper 4.52.45).
