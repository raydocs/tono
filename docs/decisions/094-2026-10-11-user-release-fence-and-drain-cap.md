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
- (c) Design, not implemented (third revision, after Sol's design review FAIL at 5b23b163: D10-F1 to D10-F3; the
  earlier D-F1 to D-F5 answers that Sol accepted are kept below).
  - **Conclusion first.** (c) can be made safe, but only with a helper-wide concurrency rewrite: every protection
    mutation in every helper process must move under one cross-process mutation lock, held across its check and its
    effect, one effect at a time. Epoch reads before and after an effect (today's `guardedEffect`) cannot be made
    linear against `/session/connect`, and the current lock graph has cycles. Honest size: about 1,500 to 2,500
    changed lines across ten helper files (about 13,000 lines today) and five app files, a new socket listener, and a
    regression per behaviour. That is 4 to 6 working days plus at least two review rounds, during the freeze. The
    owner decides between that and the minimal alternative at the end of this section.
  - Blocking code, file:line (at 5b23b163):
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
    - DNS writes are in-process System Configuration calls (`ProtectedDNSManager.swift:1192-1201`), which no deadline
      can abandon safely while they hold a lock.
    - The helper serves one connection at a time (`SocketServer.swift:401-407`) inside the update lock
      (`SocketServer.swift:931`), and the app calls it through `actor PrivilegedRuntimeCoordinator`
      (`PrivilegedRuntimeCoordinator.swift:6`).
  - **Mechanism: one mutation lock, M.** M is the existing cross-process target lock (`HelperTarget.Store.withLock`, a
    file lock beside `target-state`), promoted to the outermost lock of every protection mutation:
    - Who takes M: every helper route that changes PF, DNS, the AI layer, the Core or the target; `/session/connect`;
      the watchdog; PF supervision; the sleep and wake callbacks; the update executor (a copied helper, same code); the
      emergency CLI; and the new release listener. Read-only status takes no M.
    - What M covers: one effect at a time. Under M the holder reads the target (mode and generation), checks that the
      effect belongs to the current epoch, runs the effect, and only then releases M. A fence or a Connect can no
      longer land between the check and the effect, so stale effects need no undo and no undo can reach a newer
      session. `guardedEffect` and `stepsUnlessReleased` become this check-under-M (their after-reads go).
    - How long M is held: one effect. Each effect is one child process with its deadline (pfctl, route, networksetup
      15 s, plus 2 s TERM / KILL grace) or a DNS write moved into a bounded child (`tono-core-helper --dns-apply`, so a
      hung configd is killed, not abandoned in-process). A route with several effects takes M once per effect.
    - Abandoned holder: a holder past its effect deadline whose child cannot be reaped keeps M. M is never released
      while its effect may still land. Every other M taker, the fast release included, then fails at its own deadline
      with `unknown`, and only `--emergency-disarm` (which boots the daemon out and so ends the holder) recovers it.
      Late effects are therefore impossible, at the price of a bounded `unknown`.
    - Compatibility: only helpers that take M can write once the fence holds. A helper or executor older than 4.52.51
      does not take M. So the fast path answers `released` only when its bounded process scan (`proc_listpids`, no
      child) finds no Tono helper process other than this daemon; otherwise those components are `unknown`. A rollback
      helper older than 4.52.50 that starts later ignores the target, but finds no saved intent to heal (the release
      removed it), and the app arms it only after a user Connect.
  - **Lock graph (complete, acyclic).** M is outermost. Under M the component locks are taken in one total order, each
    at most once: target record I/O → `CoreManager.lock` → `ProtectedDNSManager.lock` → `KillSwitchManager.lock` →
    `PowerTransitionGate` lock → `CoreManager` diagnostic lock. The rewrite removes the two reverse edges:
    - The sleep and wake callbacks take M first, then call the components in this order. They no longer call Core or
      KillSwitch from inside the power lock; the power lock only records sleeping or awake.
    - The Core start gate reads `isAwake` and the PF status before taking `CoreManager.lock`, under M, which already
      excludes any change to them.
    - Paths without M (status, diagnostics, the update store, the proxy readback) take one lock at a time and never
      nest. The update lock may be held outside M (today every request runs inside it, `SocketServer.swift:931`), but
      no M holder ever waits for the update lock, so update lock → M is the only order between them. The fast path
      never takes the update lock.
    - The app's proxy writer is in the app process, so it has its own lock P in the app (below); no helper lock is
      held across an app call.
  - **Release request and epoch (D10-F1).** The fast request is `POST /release/user` with
    `{"request":"<uuid>","expectedGeneration":G|null}` on the second socket. The helper takes M (bounded) and reads
    the record:
    - `secured G'` with G' equal to `expectedGeneration`, or `expectedGeneration` null → write `released G'+1`.
    - `secured` with a different generation → `superseded`, nothing touched.
    - `released` → keep it (already fenced).
    - Missing → `released 1`. Unreadable → the existing atomic repair to `released <now in ms>`.
    - The answer carries the generation it fenced.
    The app sends null only when this app process has begun no helper session (a relaunched app). That is safe
    because only this app sends `/session/connect`, and while one of its release requests is unsettled (in flight, or
    timed out without an answer) it sends no Connect; Connect waits for the release's deadline. A retry reuses the
    same request ID, and the helper keeps the IDs it applied (in memory, bounded table) and answers them again without
    a second fence. After the app admits a Connect it never retries an older request. A daemon restarted in between
    has lost the table, but by the rule above no newer Connect exists, so the fence applies to the session the user
    released.
    Disk failure: the fence stays in memory for this daemon; the answer is `partial` with `fence: unknown`, and every
    cleanup step still runs.
  - **Deadline, coalescing, abandonment (D10-F3).** The deadline is fixed when the request's bytes are read: 50 s.
    Every wait uses what is left of it: authentication (the audit-token signature check on a worker thread), M,
    each component lock, each child, the target fsyncs and the coalescing wait. Before starting each effect the
    holder checks the deadline under M; an expired request starts no mutation and answers what it has read back.
    A second request with the same ID joins the running one and keeps its own original deadline. A request with a
    new ID waits for the running one within its own deadline.
  - **Proxy (D-F4, kept).** The app moves `SystemProxy.enable` / `disable` behind one app-side owner with lock P and
    the release request ID: the fast release takes P, records the release and disables the proxy Tono set; an enable
    that takes P after it sees the release and does nothing. Readback runs under P. networksetup is bounded (15 s), so
    P is held for at most one call.
  - Kept from the previous round (accepted by Sol): the second socket and its peer policy (same bound uid, kernel audit
    token, signed Tono without `get-task-allow`, 0600, recreated atomically); per-component answers where only a taken
    lock, a finished step, no abandoned work and a clean readback give `released`; no update-ledger access on the
    fast path; capability-gated fallback (known-version evidence only, missing socket = `unknown`, no blind call, no
    drain cap against a fence-unaware helper); a `.going` launch released only after its child is reaped.
  - Bound: 50 s from reading the request (authentication 2, M wait up to one effect 17, Core 6, DNS child 10, PF 8,
    AI 4, proxy under P 15 in the app in parallel, readback 5, inside the 50). Anything unfinished is `unknown`.
  - Regressions it would need (one per behaviour): fast path while `/update/stage` holds the update lock and another
    thread holds a component lock; a late re-seal refused across the executor and a daemon restart; proxy restore;
    the epoch against a newer Connect (and a retried request after it); the old-helper capability gate; the 50 s bound
    with a stalled child holding M.
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
