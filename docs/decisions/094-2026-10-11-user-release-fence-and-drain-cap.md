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
    never as released.
  - Rejected: an uncapped drain (no bound); cancelling or killing the stale helper call (the app cannot interrupt a
    blocking IPC call, and the helper's request loop is serial); fencing in the app only (a restarted app or a
    second process would not see it).
- Budget (explicit release, seconds, upper bounds; device-gated, not measured):

  | Stage | Bound |
  |---|---|
  | Queue: whatever privileged work is already in flight when the user clicks (the app actor and the helper's loop each run one call at a time) | **not bounded.** Known contributors: the in-flight call's own receive limit (ordinary arm / upgrade 30; `/update/stage` 600 for the request, but its copy, hash and fsync are not otherwise bounded and it holds the update lock, whose waiters allow 660); an earlier repair prompt 180 plus the 45 start-up poll; several serial actor calls queued ahead, each with its own limit |
  | Drain of cancelled work (new) | 10 |
  | Start-up: helper repair check without a prompt | 4.7 (with the administrator prompt 180 + 45) |
  | Release: Core stop 8, Core status 2, DNS restore 6, system proxy 6, `KillSwitchService.disarm` 39 (status probes 13, DNS restore 6, disarm 20) | 61 |
  | Readback: status after a disarm error 2, AI layer 6 | 8 |
  | Total after the queue | 83.7 (with repair 308.7) |
  | Pending-update release (`/update/disconnect` 45, AI 6, status 6) | 57 |

  The 60 s UI deadline (decision 092) only stops the UI waiting and shows "unknown, still finishing"; it is not a
  bound on the release. With (a) and (b) the release is bounded after it starts, but its start still waits for the
  privileged work in flight (the queue row, not bounded). (c) addresses that.
  The drain cap applies only against a helper known to fence (the daemon last heard from in this app session answered
  this build's helper version; nothing is probed for it). Against any other helper, or before the first answer, the
  release keeps the uncapped wait.
  Known limit of (a): a fence the disk refused binds only the running daemon (in memory). The update executor and a
  restarted or swapped daemon read the record on disk, so they are not fenced; the release still runs and reads back,
  but nothing reports the fence as not durable to the app. (c) makes a durable fence a condition of "released".
- (c) Design, not implemented (revised after Sol's design review FAIL at b2124fb7, D-F1 to D-F5): a release that does
  not queue behind the helper's request loop or a long privileged call. Implementation waits for Sol's design PASS and
  then ships as helper 4.52.51.
  - Blockers today, file:line:
    - The helper serves one connection at a time on its accept loop
      (`tooling/scripts/core-helper/SocketServer.swift:401-407`: `accept`, then `handle(client)` inline).
    - Every request except `/helper/upgrade` runs inside the update lock (`SocketServer.swift:931`,
      `updates.storage.locked`), and `/update/stage` holds it for the whole copy (`HelperManager.swift:1403`).
    - In the app, every helper call goes through `actor PrivilegedRuntimeCoordinator`
      (`apps/macos/Tono/Core/PrivilegedRuntimeCoordinator.swift:6`) as a blocking call, including the repair prompt
      (`HelperManager.swift:323`, 180 s, then the 45 s start-up poll) and the system proxy cleanup.
    - `KillSwitchManager`, `ProtectedDNSManager` and `CoreManager` each guard their state with a plain `NSLock`
      (`KillSwitchManager.swift:147`, `ProtectedDNSManager.swift:86`, `CoreManager.swift:8`) taken without a deadline;
      `PowerTransitionGate.whileAwake` (`HelperPower.swift:18`) and `CoreManager`'s diagnostic lock are taken inside
      them.
    - A launch that claimed `go` waits for its commit without a bound (`HelperCommandLaunch.wait`,
      `KillSwitchManager.swift:228-231`: `.going` → `committed.wait()`), while the caller holds its manager's lock.
  - One release epoch (D-F5). The app's Restore mints `epoch = (sessionGeneration G it last began, request UUID)` and
    every part of that one release carries it: the fast request, the old mutators' undo, and the trailing queued
    release (today's sequence). The helper's fence is a compare-and-swap on G under the target lock: it writes
    `released <G+1>` only while the record is `secured <G>` (or already `released`, which it leaves as is). A record at a
    newer `secured` generation means a newer Connect began: the fast path answers `superseded` and touches nothing.
    The same check guards everything later in the epoch: an undo, the trailing release's cleanup and its deferred
    bookkeeping run only while the record is still this epoch's `released <G+1>`, so no stale effect or cleanup can
    reach a newer Connect. A fence write that is abandoned past its budget and lands late takes the same lock and the
    same compare, so it cannot revoke a Connect that began meanwhile.
  - Durable fence (D-F1). "Released" requires the fence on disk: the record written, fsynced and its directory
    synced, then read back as this epoch's generation. Without that (disk refused, budget passed), the in-memory fence
    still binds this daemon (now under a lock, as in round 10's code), but the result is `partial` with the fence named
    unknown and the Support page's `--emergency-disarm` as the exit, because the update executor (a copied helper run
    by launchd) and a restarted or swapped daemon read only the disk. Compatibility: helpers from 4.52.50 read the
    same `released <n>` record (decision 084); a rollback to a helper older than 4.52.50 ignores it, so the app never
    treats such a helper as fence-aware. The executor already treats `released` as release authority (decision 092).
  - Ownership of a stalled launch (D-F2). A `.going` launch is never given up on a timeout alone. Past `commitBudget`
    the caller sends SIGKILL to the child it started and waits for its exit status (`waitpid` through the process's
    termination handler), bounded by the release deadline. Only a reaped child turns into a terminal failure that
    releases the manager's lock. A child that is not reaped in time stays registered as abandoned work of that
    manager (below), and its component reads unknown until it is reaped. TERM / KILL alone is not taken as proof.
  - One deadline, owned work (D-F3).
    - A single monotonic deadline (`DispatchTime`) is fixed when the request is accepted, 50 s after it; every step
      gets `min(its own budget, time left)`, nested children and their TERM / KILL grace included, every pfctl /
      route / networksetup query, every SystemConfiguration call (run on a worker thread and abandoned at the
      deadline) and the target write with its fsyncs.
    - Abandoned work is owned: each manager keeps a table of the threads and child pids it gave up waiting for; the
      readback reports that component unknown while the table is not empty, whatever a transient clean read says.
    - Each manager gains one timed, non-recursive lock API (`withLock(until:)`) that refuses (instead of deadlocking)
      when the calling thread already holds it; the fast path never holds two manager locks at once.
    - Lock graph (outer → inner, the only edges): target lock → nothing; `CoreManager.lock` → diagnostic lock;
      `KillSwitchManager.lock` → `PowerTransitionGate` lock (the disarm runs under `whileAwake`); `ProtectedDNSManager.lock`
      → nothing; the update lock is never taken. The fast path takes them one at a time in the order target → Core →
      DNS → PF → AI → proxy.
    - Socket I/O and authentication are bounded: 1 s receive and send timeouts, a 4 KiB request cap, the peer's audit
      token read from the socket (`LOCAL_PEERTOKEN`), and the code-signature check run under the deadline.
    - Coalescing: one fast release runs at a time. A second request with the same epoch joins it and gets the same
      result; a newer epoch waits for it, then runs its own compare-and-swap.
  - Proxy (D-F4). The fast path also restores the system proxy settings Tono owns (services whose HTTP / HTTPS /
    SOCKS proxy points at Tono's local listener) through SystemConfiguration and reads them back. The app's proxy
    writer, which today runs inside `PrivilegedRuntimeCoordinator`, takes the same epoch check before and after its
    write (the `guardedEffect` shape): a write that lands after the fence is undone. Without this a Core stop could
    leave ordinary browsing pointed at a dead proxy.
  - Route and authentication. A second socket `/var/run/tono-core-helper.release.sock`, created by the daemon at start
    in a root-owned directory, mode 0600, owned by the same bound uid as the main socket, unlinked and recreated
    atomically on each start. One route, `POST /release/user`, body exactly `{"epoch":{"sessionGeneration":G,"request":
    "<uuid>"}}`. The peer must be the bound uid, and its kernel audit token must carry Tono's signature with
    `get-task-allow` absent. No new cross-user authority.
  - Answer: `{"result":"released"|"partial"|"unknown"|"superseded","components":{"fence","core","dns","pf","ai",
    "proxy":"released"|"present"|"unknown"}}`. A component is `released` only when its lock was taken, its step
    succeeded, no abandoned work remains for it and the readback is clean; a missed lock or a failed undo stays
    unknown for the whole epoch.
  - No ledger on the fast path. It never reads or writes the update ledger, never retires and never sets
    `disconnectVerified`. The update executor learns of the release from the durable target. Deferred bookkeeping
    (`disconnectRequested` / `disconnectVerified`) stays in the trailing `/update/disconnect`, under the update lock and
    only for a matching epoch.
  - App and legacy fallback. The app sends the request at once on its own thread, outside
    `PrivilegedRuntimeCoordinator`, then the trailing release queues as today. The capability is known from the daemon's
    earlier `/version` answer in this session (4.52.51 or later), never from a version probe queued behind the call
    the fast path is meant to bypass. A missing socket is not proof of an old helper: against a fence-capable helper it
    is `unknown` plus `--emergency-disarm`. Against a helper without the capability the app sends no blind release,
    applies no drain cap, and runs today's queued path.
  - Bound: one 50 s deadline from accepting the request (target 4, authentication 2, Core 6, DNS 10, PF 10, AI 8,
    proxy 5, readback 5); the app's receive timeout is 55 s. Anything not finished is `unknown`, never `released`.
  - Failure modes: daemon dead or stopped (`SIGSTOP`): no answer, so unknown plus `--emergency-disarm`. Disk refuses
    the fence: `partial`, fence unknown. A pfctl / networksetup / SC call that hangs: abandoned at the deadline, so
    that component is unknown. An arm that lands after the fence: undone by its after-read
    (`runLateReblockAfterUserReleaseSelfTest`). A newer Connect before the fence: `superseded`, nothing touched.
  - Cost: a protocol change (new socket, route and answer), helper 4.52.51, timed locking and abandoned-work tables in
    the three managers, the proxy writer's epoch check, and the `.going` ownership change.
  - Minimal alternative if (c) is rejected: keep (a) + (b) and state the queue as not bounded (contributors in the
    budget table), with `--emergency-disarm` as the escape, which does not use the daemon's socket.
- (d) The Support page shows `--emergency-disarm` as a last-resort local administrator command that is not a substitute
  for Restore normal internet. It latches the release, stops the daemon, releases PF, DNS and the AI layer, reads each
  back, prints one line per step, exits 0 only when everything read back released, and keeps Tono installed.
  `--emergency-reset` stays, labelled as helper removal (also how Tono moves to another macOS account): its release
  reads nothing back, and with an update pending it only releases.
- Why stricter: nothing older than the user's release can block the network again after it, and nothing automatic
  re-arms; only the user's Connect does. No path releases more than before: the fence is release authority only for
  what the user already asked to release.
- Applied in: #1504 round 10 (helper 4.52.50, no protocol change).
