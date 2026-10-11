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
  | Queue: the helper call already in flight when the user clicks (one request at a time, in the app actor and in the helper) | ordinary ≤ 30 (`/killswitch/arm`, `/helper/upgrade`); `/update/stage` ≤ 600; an earlier repair prompt ≤ 180 + 45 |
  | Drain of cancelled work (new) | 10 |
  | Start-up: helper repair check without a prompt | 4.7 (with the administrator prompt 180 + 45) |
  | Release: Core stop 8, Core status 2, DNS restore 6, system proxy 6, `KillSwitchService.disarm` 39 (status probes 13, DNS restore 6, disarm 20) | 61 |
  | Readback: status after a disarm error 2, AI layer 6 | 8 |
  | Total after the queue | 83.7 (with repair 308.7) |
  | Pending-update release (`/update/disconnect` 45, AI 6, status 6) | 57 |

  The 60 s UI deadline (decision 092) only stops the UI waiting and shows "unknown, still finishing"; it is not a
  bound on the release. With (a) and (b) the release is bounded after it starts, but its start still waits for the
  in-flight helper call (the queue row). (c) addresses that.
- (c) Design, not implemented: a release that does not queue behind the helper's request loop or a long privileged
  call. Implementation waits for Sol's design PASS.
  - Blockers today, file:line:
    - The helper serves one connection at a time on its accept loop
      (`tooling/scripts/core-helper/SocketServer.swift:401-407`: `accept`, then `handle(client)` inline).
    - Every request except `/helper/upgrade` runs inside the update lock (`SocketServer.swift:931`,
      `updates.storage.locked`), and `/update/stage` holds it for the whole copy (app timeout 600 s,
      `apps/macos/Tono/Core/HelperManager.swift:1403`).
    - In the app, every helper call goes through `actor PrivilegedRuntimeCoordinator`
      (`apps/macos/Tono/Core/PrivilegedRuntimeCoordinator.swift:6`) as a blocking call, including the repair prompt
      (`HelperManager.swift:323`, 180 s, then the 45 s start-up poll).
    - `KillSwitchManager`, `ProtectedDNSManager` and `CoreManager` each guard their state with a plain `NSLock`
      (`KillSwitchManager.swift:147`, `ProtectedDNSManager.swift:86`, `CoreManager.swift:8`) taken without a deadline.
    - A helper child launch that claimed `go` waits for its commit without a bound
      (`HelperCommandLaunch.wait`, `KillSwitchManager.swift:228-231`: `.going` → `committed.wait()`). The launch thread
      only writes three bytes to an empty pipe there, but nothing bounds it, and the caller holds its manager's lock
      meanwhile, so a release waiting on that lock inherits the wait.
  - Design: a dedicated release listener in the helper.
    - A second socket (`/var/run/tono-core-helper.release.sock`, same owner uid and mode 0600, same peer authorizer)
      served by its own thread. It accepts one route, `POST /release/user`, from the owner's signed app only.
    - Order: (1) the fence (target lock, 2 s budget; the in-memory fallback on failure), which is what makes the rest
      safe to run beside an in-flight call: from here the in-flight call can only end refused or undone. (2) Core
      stop, DNS restore, PF release and AI removal, each taking its manager's lock with `lock(before:)` and a budget
      (Core 6, DNS 8, PF 15, AI 15). (3) Per-component readback (PF anchor, Core, TUN, DNS, AI resolvers and routes),
      as `--emergency-disarm` does. It never takes the update lock: the update executor already treats a `released`
      target as release authority (decision 092), so the fence, not the ledger, tells a pending update what happened.
    - The `.going` wait gets a bound too (`commitBudget` again, 5 s): past it the caller terminates the child it
      launched (TERM, then KILL after 1 s), reports the launch failed, and releases its lock, so a stalled launch
      thread cannot hold the manager's lock, and through it the release, indefinitely.
    - A lock it cannot take in time means an in-flight call holds that component. The fence makes that call undo
      itself or be refused when it finishes, so the listener reports that component unknown (never released) and
      the app publishes unknown. Nothing is reported released that was not read back.
    - App: Restore normal internet sends `/release/user` on its own queue, outside `PrivilegedRuntimeCoordinator`,
      at once; the existing release sequence then runs behind it as today and finds the work done. An older helper
      without the socket falls back to today's path.
    - Bound: fence 2 + Core 6 + DNS 8 + PF 15 + AI 15 + readback 10 = 56 s, independent of the queue; app receive
      timeout 60 s.
    - Failure modes: daemon dead or stopped (`SIGSTOP`): the socket does not answer, the app shows unknown and the
      Support page's `--emergency-disarm`. Disk full: in-memory fence (lost if the daemon restarts; the app's
      `connectAwaitsUser` still keeps automatic connects off). A pfctl or networksetup child that hangs: bounded by
      the existing child deadlines. An arm that lands after the fence: undone by its after-read (helper self-test
      `runLateReblockAfterUserReleaseSelfTest`).
    - Cost: a protocol change (new socket and route) and a helper version above 4.52.50, plus timed locking in the
      three managers. That is why it is not in this PR.
  - Minimal alternative if (c) is rejected: keep (a) + (b) and record the queue bound (≤ 600 s behind `/update/stage`,
    ≤ 225 s behind a repair prompt) with `--emergency-disarm` as the escape, which does not use the daemon's socket.
- (d) The Support page shows `--emergency-disarm` as a last-resort local administrator command that is not a substitute
  for Restore normal internet. It latches the release, stops the daemon, releases PF, DNS and the AI layer, reads each
  back, prints one line per step, exits 0 only when everything read back released, and keeps Tono installed.
  `--emergency-reset` stays, labelled as helper removal (also how Tono moves to another macOS account): its release
  reads nothing back, and with an update pending it only releases.
- Why stricter: nothing older than the user's release can block the network again after it, and nothing automatic
  re-arms; only the user's Connect does. No path releases more than before: the fence is release authority only for
  what the user already asked to release.
- Applied in: #1504 round 10 (helper 4.52.50, no protocol change).
