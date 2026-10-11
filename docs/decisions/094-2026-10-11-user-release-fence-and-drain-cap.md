## 2026-10-11 · macOS: the user's release fences older work, and caps its wait for it
- Status: owner (owner approved 2026-10-11 via Puck, the "bounded-release minimal option" of #1504 round 9: (a) fence,
  (b) drain cap, (c) a queue-independent release designed here and implemented only after Sol's design review, (d)
  the Support page shows `--emergency-disarm`)
- Question: the explicit release (Restore normal internet, the user's Disconnect) waited, without a bound, for
  cancelled connect / switch / reload / update work, because that work could still arm PF, start the Core or point DNS
  at 127.0.0.1 after the release. Nothing in the helper refused it: only the administrator's `--emergency-disarm`
  wrote a `released` target (decision 084).
- Chosen:
  - (a) Fence. The helper's `/killswitch/disarm` (and the user's `/update/disconnect`) first persist
    `released <n+1>` under the target lock with the same code as `--emergency-disarm` (`HelperTarget.fenceUserRelease`,
    `tooling/scripts/core-helper/OperatorRelease.swift`), then stop the Core and restore DNS (best effort, in case
    older work committed them before the fence), then disarm. From then on every arm of an older session, a Core
    start or sync, a DNS enable, PF supervision, the power barrier and owner relaunch are refused, and an effect in
    flight is undone by its after-read (`guardedEffect`). Only `/session/connect`, which only the user's Connect
    sends, begins a newer `secured` generation. A target write that fails (full disk) keeps the same fence in memory
    until the next user Connect or daemon exit; the release never waits on the disk. Refusal text: "Protection is
    off. Click Connect in Tono to reconnect."
    App side: the user's release records `connectAwaitsUser` (`RuntimeCleanup`); launch auto-connect and every other
    automatic connect consume their intent quietly (not connected, no error) until a user Connect's helper session
    begins. The receive timeout of `/killswitch/disarm` goes from 6 s to 20 s (target lock 2 + Core stop 4.1 + DNS
    restore 6 + PF disarm 6).
    No route, field or file format changed: the fence is the existing `released <n>` record, and the app flag is a
    new local preference.
  - (b) Drain cap. The explicit release waits at most `explicitReleaseDrainCap` = **10 s** for cancelled work and an
    earlier teardown (`ConnectionCoordinator.enqueueDisconnect`), then runs. What that work sends afterwards is
    refused by (a); its UI results are retired by the protection generation. When it ends, the app clears the system
    proxy and reads PF back once under the release's generation; a verified live block is published as it is, an
    unreadable status does not replace the release's own readback. A timeout anywhere is published as unknown,
    never as released. The capped work still runs its own effects (an older teardown still turns the proxy off and
    restricts PF), so until it and that readback have ended no newer Connect is admitted and no later teardown runs
    (R10-F1, `ConnectionCoordinator.cappedStaleWork`): the user's Connect waits, the release does not.
  - Rejected: an uncapped drain (no bound); cancelling or killing the stale helper call (the app cannot interrupt a
    blocking IPC call, and the helper's request loop is serial); fencing in the app only (a restarted app or a
    second process would not see it).
- Budget (explicit release, seconds; device-gated, not measured). The rows are per-call limits, and the totals are
  **not proven ceilings**: they leave out the queue and the system proxy, neither of which has a fixed bound.

  | Stage | Bound |
  |---|---|
  | Queue: whatever privileged work is already in flight when the user clicks (the app actor and the helper's loop each run one call at a time) | **not bounded.** Known contributors: the in-flight call's own receive limit (ordinary arm / upgrade 30; `/update/stage` 600 for the request, but its copy, hash and fsync are not otherwise bounded and it holds the update lock, whose waiters allow 660); an earlier repair prompt 180 plus the 45 start-up poll; several serial actor calls queued ahead, each with its own limit |
  | Drain of cancelled work (new) | 10 |
  | Start-up: helper repair check without a prompt | 4.7 (with the administrator prompt 180 + 45) |
  | Release: Core stop 8, Core status 2, DNS restore 6, `KillSwitchService.disarm` 39 (status probes 13, DNS restore 6, disarm 20) | 55, plus the system proxy |
  | System proxy (only when Tono set one, `SystemProxy.didSetProxy`: a session without TUN; the managed TUN session never sets it) | **no fixed bound.** Contributors: `networksetup -listallnetworkservices` for the saved service, waited with `waitUntilExit` (no limit); then up to 6 `networksetup` children (3 without a snapshot) at 15 each plus 0.3 kill grace; on any failure one `osascript` administrator fallback of 180. Without the lookup that is up to about 272 |
  | Readback: status after a disarm error 2, AI layer 6 | 8 |
  | Total after the queue, without the system proxy | 77.7 (with repair 302.7); not a ceiling |
  | Pending-update release (`/update/disconnect` 45, AI 6, status 6) | 57 |

  The 60 s UI deadline (decision 092) only stops the UI waiting and shows "unknown, still finishing"; it is not a
  bound on the release. With (a) and (b) the release's helper calls are bounded after it starts (the system proxy,
  when Tono set one, is not), but its start still waits for the privileged work in flight (the queue row, not
  bounded). (c) addresses that.
  The drain cap applies only against a helper known to fence (the daemon last heard from in this app session answered
  this build's helper version; nothing is probed for it). Against any other helper, or before the first answer, the
  release keeps the uncapped wait.
  Known limit of (a): a fence the disk refused binds only the running daemon (in memory). The update executor and a
  restarted or swapped daemon read the record on disk, so they are not fenced; the release still runs and reads back,
  but nothing reports the fence as not durable to the app. (c) makes a durable fence a condition of "released".
- (c) Design, not implemented (fourth revision, after Sol's design review FAIL at 8632c8c3: D3-F1 to D3-F4. Sol found
  one cross-process serialization point feasible in principle; the earlier accepted answers are kept below).
  - **Conclusion first.** (c) is a dedicated helper-wide concurrency milestone, not a socket added during the freeze.
    It needs four mechanisms specified here before any code: crash-stable ownership of the mutation lock M across
    child processes and holder death (D3-F1), a release bound to a durable session epoch with replay that never
    returns stale success (D3-F2), a durable launch floor that keeps fence-unaware helpers from being put in place
    while the user's release holds (D3-F3), and the system proxy moved under the same M and epoch (D3-F4). Revised
    estimate at the end of this section. Option 2 permits no packages until a conforming (c) candidate and its device
    evidence exist.
  - Blocking code, file:line (at 5b23b163, unchanged since):
    - `HelperTarget.guardedEffect` (`tooling/scripts/core-helper/OperatorRelease.swift:283-296`) compares only the
      mode before and after an effect, so allowed G → released G+1 → allowed G+2 looks like "allowed" both times, and
      the effect is not excluded from a Connect in between. Its users: `KillSwitchPF.swift`, `ProtectedDNSManager.swift`,
      `SelectiveFailOpen.swift` and nine sites in `OperatorRelease.swift`.
    - Lock cycles: power → Core / KillSwitch (`SocketServer.swift:1099-1103`, `1121-1122`: the sleep and wake callbacks
      stop the Core and arm inside `PowerTransitionGate.whileAwake`), and Core → power / KillSwitch (`CoreManager.swift:
      102-105` holds `CoreManager.lock` while the start gate at `SocketServer.swift:1018-1020`, `1036-1042` reads
      `transitionGate.isAwake()` and `killSwitch.status()`).
    - The helper session generation lives only in the app's memory (`apps/macos/Tono/Core/HelperManager.swift:957-980`),
      so a relaunched app has no G.
    - DNS writes are in-process System Configuration calls (`ProtectedDNSManager.swift:1192-1201`, under a non-blocking
      `SCPreferencesLock`, `:1276-1282`), which no deadline can abandon safely.
    - The target lock is opened `O_CLOEXEC` (`OperatorRelease.swift:359-361`), so it never protects a child.
    - The update executor's rollback restores `backup.helper` and then starts the daemon (`UpdateExecutor.swift:320-340`).
    - The system proxy is written by the app (`apps/macos/Tono/Core/SystemProxy.swift:275-284`, `403-414`, `419-464`:
      several 15 s `networksetup` children, a 180 s `osascript` fallback, `waitUntilExit` after TERM / KILL).
    - The helper serves one connection at a time (`SocketServer.swift:401-407`) inside the update lock
      (`SocketServer.swift:931`), and the app calls it through `actor PrivilegedRuntimeCoordinator`
      (`PrivilegedRuntimeCoordinator.swift:6`).
  - **M and its ownership (D3-F1).** M is a `flock` on one fixed lock file, `/Library/Application Support/Tono/
    mutation.lock` (root, 0600, opened `O_NOFOLLOW`, ownership and mode checked on the descriptor; created if missing,
    **never unlinked or replaced**, so M cannot split into two files). It is the outermost lock of every protection
    mutation (who takes it: below). A `flock` belongs to the open file description, not to the process, so:
    - **Ownership travels with the effect.** The holder opens the lock file without `O_CLOEXEC`, takes the `flock`,
      and starts each effect child with `posix_spawn` using `POSIX_SPAWN_CLOEXEC_DEFAULT` (every other descriptor
      closed) plus an explicit inherit of the M descriptor and stdio, in a new process group
      (`POSIX_SPAWN_SETPGROUP`). The child does not acquire M (no deadlock): it shares the holder's description. M
      stays held while the holder, the child or any descendant still has that description open. If the daemon dies
      or is booted out mid-effect, M stays held by the child until the last descendant exits.
    - **Holder death and recovery.** Before spawning, the holder writes a durable owner record beside the lock
      (`mutation-owner`, root 0600, fsync, under M): epoch (below), component, effect kind, process group, child pid
      and its start time (`proc_pidinfo PROC_PIDTBSDINFO`, so a reused pid does not match), and the effect deadline.
      It clears the record only after the child is reaped and the component read back. Whoever next acquires M and
      finds a record left behind treats that component as `unknown` until its own readback under M; it never infers
      "done" from the record.
    - **Abandoned effect.** At the effect deadline the holder sends SIGTERM, then SIGKILL, to the process group, and
      releases its own reference to M only after `waitpid` reaped the child. A child that cannot be reaped keeps M
      (through the holder and through itself). Every other taker, the fast release included, then fails its own
      bounded acquisition with `unknown`. A child stuck in the kernel keeps M until it exits or the Mac restarts; that
      is the price of "no late effect".
    - **Long-running children.** The Core (sing-box) must not inherit M: its spawn and `go` admission run under M, and
      the Core is started with the M descriptor closed. Its later effects (TUN, routes) end when it is stopped; a Core
      stop is an effect under M that counts as done only after the process is reaped.
    - **Emergency CLI.** `--emergency-disarm` keeps its first step, the unconditional flush of Tono's PF anchor (it can
      only remove Tono's rules, never block). Every other step, and any `released` claim, waits for M within the
      command budget: it may SIGKILL the process group named in the owner record (matched by pid and start time),
      then acquire M. If it cannot, it prints `unknown` for the affected components and the holder's pid, exits
      non-zero, and does not touch the lock file. It never deletes or replaces the lock to get past a holder.
      (Sol to judge whether the unconditional anchor flush is acceptable; it is today's escape-hatch property.)
    - **DNS, corrected.** Killing `--dns-apply` kills the System Configuration client, not configd. What proves the
      write can no longer land: the DNS write is one `SCPreferencesCommitChanges` (an atomic replace of the stored
      preferences, made by the client while it holds the preferences lock) followed by `SCPreferencesApplyChanges`,
      which only asks configd to apply what is **currently stored**. So after the child is reaped: (1) a fresh
      `SCPreferencesLock` taken by a readback child proves the dead client no longer holds the preferences lock, and
      no commit of its can land afterwards; (2) the stored DNS of each service read under that lock equals the
      target; (3) the dynamic store's `State:` DNS equals the target after a bounded settle inside the request
      deadline. A late apply from the old client then applies the newer stored value, never the stale one. If any
      step fails or times out, DNS is `unknown` and its owner record stays. Both premises (the lock is released when
      the client dies; an apply reads current stored state) are device gates below; if either fails on a real Mac,
      DNS can only ever be `unknown` after an abandoned write.
    - **`--dns-apply` is a closed root entry.** It runs only as root with real uid 0, reads one request file written
      under M in the target directory (root 0600, `O_NOFOLLOW`, named by an argument that must match the owner
      record), accepts only service IDs that exist in `SCPreferences` and the fixed loopback DNS or the saved
      snapshot, and never takes a caller-supplied path, command or service name.
  - **Who takes M.** Every path that can change PF, DNS, the AI layer, the Core, the system proxy (D3-F4) or the
    target: the helper routes, `/session/connect`, the watchdog, PF supervision and PF healing, the sleep and wake
    callbacks, start-up reconcile, the update executor (a copy of the installed helper), the emergency CLI and the new
    release listener. **A status route must be genuinely read-only**: today's PF status can heal; that heal moves out
    of status into the watchdog under M. Every old guard, effect and undo is mapped to its new owner and captured
    epoch in the implementation PR (a table, one row per site); `guardedEffect`, `stepsUnlessReleased` and the undo
    paths go. Under M the target lock is not taken again recursively (the target is read and written through the
    descriptor M's holder already owns), and no in-process component lock is held while waiting for M.
  - **Lock graph (complete, acyclic).** M is outermost. Under M the component locks are taken in one total order, each
    at most once: target record I/O → `CoreManager.lock` → `ProtectedDNSManager.lock` → `KillSwitchManager.lock` →
    `PowerTransitionGate` lock → `CoreManager` diagnostic lock. The sleep and wake callbacks take M first and no longer
    call Core or KillSwitch from inside the power lock; the Core start gate reads `isAwake` and PF status under M
    before `CoreManager.lock`. Paths without M (read-only status, diagnostics, the update store) take one lock at a
    time and never nest. No M holder waits for the update lock, so update lock → M is the only order between them; the
    fast path never takes the update lock. `flock` is not fair, so a waiter can be passed over more than once: the M
    wait has a deadline, not a proven acquisition ceiling.
  - **Session epoch and the release request (D3-F2).** The null request is removed.
    - The epoch is durable: `/session/connect` writes `secured <G> <session>` where `session` is a helper-minted
      random ID, under M, fsynced. G stays monotonic across daemon restarts because it is on disk (an unreadable
      record is repaired to `released <now in ms>`, above any earlier G).
    - The release always binds to an epoch it observed. An app that holds no epoch (relaunched, or a second Tono
      instance) first reads it from `GET /release/epoch` on the release socket (read-only, no M). Then
      `POST /release/user {"request":"<uuid>","expected":<epoch or "missing" / "unreadable">}`. Under M:
      `secured` equal to expected → write `released <G+1> <session>`; `secured` with any other epoch → `superseded`
      with that epoch, nothing touched; `released` → nothing written, `already released`; missing or unreadable equal
      to expected → write `released` (no session exists, so no Connect can be revoked; this is the local recovery
      without a Connect). Every answer carries the current epoch and a fresh readback.
    - **Replay and retry.** A retry reuses the request ID and its expected epoch. A durable replay log in the target
      directory (the last 32 entries, written and fsynced under M before the answer: request, expected epoch, outcome,
      fenced epoch) only tells "you applied it" from "already released". Correctness does not depend on it: a retry is
      the same compare-and-swap against the expected epoch, so after a newer Connect it answers `superseded` with the
      current epoch, and an evicted or forgotten entry cannot fence twice (fencing `released` writes nothing). A
      retry never returns a cached `released`: the readback is taken again each time.
    - **Connect after an unknown answer.** No waiting rule is needed for safety: a Connect is a compare-and-swap
      from the epoch it read, so once it lands, every older release request (still waiting for M, retried, or sent by
      another app instance) finds a different epoch and answers `superseded` without mutating. The app admits a user
      Connect after an unanswered release only after re-reading the epoch, and shows what it found (released, or not
      released and now superseded by this Connect).
  - **Fence-unaware writers (D3-F3).** A scan is evidence for one instant only and is not used to claim that nothing
    can block later. Every writer that can put a helper binary in place or start one is closed:
    - Durable launch floor: the first 4.52.51 daemon writes `fence-floor` (root 0600, under M, never removed by any
      later version) naming the lowest helper that takes M. Every 4.52.51+ writer checks a binary's embedded contract
      version (a signed `__TEXT` section read from the file, no execution) before placing or starting it.
    - Update executor rollback: while the target is `released` or unreadable, a rollback to a helper below the floor
      is refused. The attempt and all its evidence stay as they are (nothing discarded), PF / DNS stay released, and
      the status reports "rollback deferred until you Connect". The user's next Connect (which secures a new epoch)
      runs the existing recovery. A forward update is never below the floor.
    - launchd `KeepAlive` restarts whatever binary is installed; with the rollback closed, only an installer can
      put an older binary there.
    - The app installer (4.52.51+) refuses to install a helper below the floor.
    - Not closable: an older Tono app installing its own older helper with an administrator password. That is an
      administrator's downgrade, outside this guarantee, and stated as a limit. Helpers 4.52.50 still honour the
      `released` record (with today's before / after race); helpers below 4.52.50 ignore it. A 4.52.51+ app launched
      later that finds an installed helper below the floor while `fence-floor` exists shows protection `unknown`
      and offers repair.
    - The scan (`proc_listpids`, `proc_pidpath`, start time) stays as evidence: any Tono helper process other than
      this daemon and its own M children, a pid whose path cannot be read, or a failed scan makes the affected
      components `unknown` in that answer.
  - **System proxy under M (D3-F4).** The proxy moves into the helper: `/proxy/enable` and `/proxy/disable` run
    `networksetup` as root (no `osascript` fallback, no administrator prompt), each command an effect child under M
    with the D3-F1 abandonment rules. Enable carries the session epoch and runs only if the target is `secured` with
    that same epoch, checked under M, so an enable queued before a release or before a newer Connect is refused. A
    release disables only while the target still holds the epoch it fenced; after a newer Connect the old disable is
    superseded. The pre-Tono settings move to a helper-owned snapshot (root 0600) written under M before the first
    enable and deleted only after a readback matches the restored values; an app-side snapshot from an older build is
    handed over once. Services are looked up from `SCPreferences` in a readback child, not with
    `networksetup -listallnetworkservices` and `waitUntilExit`. The whole proxy transaction uses the request's
    remaining deadline. The managed TUN session never sets a proxy, so there the proxy component reads "not set".
  - **One answer.** The release answer aggregates the fence, Core, PF, DNS, AI layer and proxy. It is `released` only
    if each component took M, finished, left no abandoned effect, and read back clean; any `unknown` (including the
    proxy and the scan) makes the aggregate not released. The deadline (50 s from reading the request; every wait,
    authentication included, uses what is left of it) bounds the **answer**, not the restoration: fsync, child reap,
    a failed acquisition, configd settling and coalescing yield `unknown` while ownership stays safe. No component
    figure in this section is a proven ceiling.
  - Kept from earlier rounds (accepted by Sol): the second socket and its peer policy (same bound uid, kernel audit
    token, signed Tono without `get-task-allow`, 0600, recreated atomically; framing and authentication on the
    remaining deadline); no update-ledger access on the fast path; capability-gated fallback (known-version evidence
    only, missing socket = `unknown`, no blind call, no drain cap against a fence-unaware helper); a `.going` launch
    released only after its child is reaped; coalescing by request ID with each request keeping its own deadline.
  - Regressions (one per behaviour): fast path while `/update/stage` holds the update lock and another thread holds a
    component lock; daemon killed mid-effect, M held by the child until it exits, next taker `unknown`; owner record
    left behind → component `unknown` until readback; a late re-seal refused across the executor and a daemon
    restart; epoch: an older release after a newer Connect → `superseded`, a retry after eviction does not fence
    twice and never returns cached `released`; rollback below the floor refused while released, evidence kept;
    proxy: stale enable refused, snapshot restored; the old-helper capability gate; the answer within 50 s with a
    stalled child holding M.
  - **Device gates (real macOS, owner's Mac; added to G1 step 6 when (c) is implemented):** SIGKILL of the daemon
    mid-pfctl (M held by the child; no re-block after it exits); SIGKILL of `--dns-apply` mid-commit (the preferences
    lock is freed; stored and `State:` DNS read back; a late apply does not bring back the old DNS); another process
    holding the preferences lock (DNS `unknown` within the deadline); `launchctl bootout` during a release (owner
    record recovery); rollback below the floor while released (refused, evidence kept, PF stays released; recovery
    after Connect); a 0.0.74 app installed over (the stated limit, later shown `unknown`); a non-TUN session with a
    user proxy set before Tono (restored exactly; stale enable refused); release from a relaunched app and from a
    second instance against a newer Connect (`superseded`); the fast path during `/update/stage`; AI layer removal
    read back.
  - **Estimate (not certified; Sol cannot certify it either).** Helper: M with inherited-descriptor effect runner,
    owner record and recovery 400–600 lines; DNS apply / readback children with the closed input 250–400; epoch,
    replay log, second socket and authentication 400–600; launch floor, rollback deferral and scan 250–400; proxy in
    the helper 400–600; status made read-only and every guard / effect / undo site moved 400–800. App: release
    client, epoch read, aggregation and proxy hand-over 500–800. Regressions 800–1,200. Total about 3,400 to 5,400
    changed lines, roughly 3 to 4 weeks of implementation, with review rounds set by evidence rather than a count,
    then the device gates. It belongs in its own milestone after the four mechanisms here pass design review.
  - **Minimal alternative** (what this PR ships today, and Sol's stated safe interim): (a) + (b) + (d), the drain
    uncapped against fence-unaware helpers, the queue stated as not bounded, and the administrator's
    `--emergency-disarm` as the exit. It does not meet the owner's one-click hard gate.
- (d) The Support page shows `--emergency-disarm` as a last-resort local administrator command that is not a substitute
  for Restore normal internet. It latches the release, stops the daemon, releases PF, DNS and the AI layer, reads each
  back, prints one line per step, exits 0 only when everything read back released, and keeps Tono installed.
  `--emergency-reset` stays, labelled as helper removal (also how Tono moves to another macOS account): its release
  reads nothing back, and with an update pending it only releases.
- Why stricter: nothing older than the user's release can block the network again after it, and nothing automatic
  re-arms; only the user's Connect does. No path releases more than before: the fence is release authority only for
  what the user already asked to release.
- Applied in: #1504 round 10 (helper 4.52.50, no protocol change).
