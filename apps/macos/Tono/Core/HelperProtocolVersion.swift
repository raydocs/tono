/// One shared install/runtime contract for both the GUI and the separately
/// compiled privileged helper. Keeping the value in one source file prevents
/// the app from silently accepting an older helper after its PF behavior
/// changes.
nonisolated enum HelperProtocolVersion {
    /// Bump this on ANY change to the helper: its IPC request contract, its PF
    /// rendering, or its client requirement. `HelperManager.prepare` decides
    /// whether to reinstall by comparing this string alone, so a stale value
    /// means the app reports `helper_already_current` and the old daemon keeps
    /// running forever while every gate passes vacuously. This has now cost two
    /// shipped builds, in both directions:
    ///
    /// - 3.6.0 → 3.7.0: the arm request gained `reviewedBundleDirect`. Left at
    ///   3.6.0, the new field reached a daemon whose allowlist rejected it and
    ///   no session could arm (`Invalid Kill Switch arm request`).
    /// - 3.7.0 → 3.8.0: the reviewed-bundle permit gained the `from any to any`
    ///   that PF requires before `port`. The contract is unchanged, but the
    ///   *renderer* lives in the daemon, so without a bump the fix would never
    ///   have been installed.
    ///
    /// `tooling/scripts/build-core-helper.sh` now fails the build when helper
    /// sources change without this string changing.
    ///
    /// - 3.8.0 → 3.8.4: added `--lifecycle-self-test`, which is test-only and
    ///   changes no runtime behaviour. The gate cannot tell that apart from a
    ///   behavioural change, and that coarseness is deliberate: a missed bump
    ///   costs a silently unupgraded daemon, which has already cost two shipped
    ///   builds, while an unnecessary bump costs one administrator prompt.
    /// - 3.10.3 → 3.11.0: a withdrawal that is expressible as a set of addresses
    ///   now kills only those addresses' states instead of flushing every state
    ///   on the machine. The IPC contract is unchanged apart from an added
    ///   `killedHosts` counter, but the behaviour lives entirely in the daemon,
    ///   so without this bump no installed helper would ever stop flushing.
    /// - 3.11.0 → 3.11.2: the arm commit guard reports which of its two
    ///   conditions failed, and a superseded arm carries the machine-readable
    ///   `KILLSWITCH_ARM_SUPERSEDED` so the app can retry it instead of showing
    ///   the user an error. Both live in the daemon, so a stale one would keep
    ///   emitting the message that misattributed a concurrency failure to the
    ///   user's network.
    /// - 3.11.2 → 3.12.0: Restore Internet sweeps leftover `127.0.0.1` DNS on
    ///   every live service, and Enable refuses to snapshot the Mihomo
    ///   listener as "original DNS". Without this bump, a 64 GUI talking to a
    ///   3.11.2 daemon still restores a missing snapshot as success and can
    ///   open PF with no working resolver.
    /// - 3.12.0 → 3.12.1: The restore sweep reaches services macOS has
    ///   disabled — they keep whatever DNS they were left with, and skipping
    ///   them deleted the snapshot that could have recovered them — and one
    ///   service that will not commit no longer abandons the others. A start
    ///   refused because a core is already running now carries
    ///   `CORE_ALREADY_RUNNING`, so the app's orphaned-core recovery stops
    ///   depending on the wording of an English sentence.
    /// - 3.12.1 → 3.12.2: Every rendered PF rule carries a class `label`
    ///   (`tono-exit`, `tono-bundle`, `tono-control`, …). pfctl was collapsing
    ///   each exact permit into the reviewed-bundle permit that subsumes it: on
    ///   a live armed machine the rendered file held 58 exact permits and the
    ///   kernel held 13 rules with none of them, so nothing about the boundary
    ///   could be measured from a counter. Labels make the rules
    ///   non-interchangeable, so they survive and `pfctl -s labels` attributes
    ///   packets per class. No traffic decision changes — pins render before the
    ///   bundle permits, every rule is `quick`, and a pin permits a subset of
    ///   what the bundle permits. Bumped because the daemon's rule text changed:
    ///   a 3.12.1 daemon renders unlabelled rules and the boundary stays
    ///   unmeasurable while every gate above it passes.
    /// - 3.12.2 → 3.13.0: protected DNS reads and writes go through
    ///   System Configuration instead of forking `networksetup` on every
    ///   connect. Snapshot, Empty/DHCP restore, and the leftover-loopback
    ///   sweep are unchanged; `networksetup` remains the fallback if SC
    ///   refuses. Bumped because the daemon now talks to a different API.
    /// - 3.13.0 → 3.13.1: an arm clears its remembered PF-rule baseline before
    ///   committing the new ruleset. If PF enable, state disposal, or a later
    ///   verification then fails, the next arm performs a conservative full
    ///   state flush instead of comparing against a generation that never
    ///   finished committing and potentially retaining a withdrawn permit.
    /// - 3.13.1 → 3.14.0: helper PF rendering and lifecycle self-tests live in
    ///   their own source files. Behaviour is unchanged; the bump exists so
    ///   installed daemons pick up the same compiled helper.
    /// - 3.14.0 → 3.15.0: helper dispatch, Core supervision, HTTP read/send,
    ///   power-transition gate, and socket server live in their own source
    ///   files. Behaviour is unchanged; the bump exists so installed daemons
    ///   pick up the same compiled helper. Compile and CONTRACT hash now share
    ///   one source-file manifest in `build-core-helper.sh`.
    /// - 3.15.0 → 3.16.0: proxy endpoints may be UDP (hy2 on the same public
    ///   IPv4/port as VLESS TCP). A 3.15.0 daemon rejects `transport: udp` and
    ///   would leave the backup path fail-closed even after the GUI admits it.
    /// - 3.16.0 → 3.17.0: PF permits Apple Continuity on `awdl0`, mDNS 5353 to
    ///   the link-local multicast groups, and IPv6 link-local unicast. Without
    ///   this bump a 3.16.0 daemon keeps dropping Universal Clipboard and
    ///   Sidecar while the GUI thinks the helper is current.
    /// 4.0: sing-box JSON staging/check, protected process replacement, new
    /// signed executable identity. Never accept the old Mihomo daemon.
    /// - 4.0.0 → 4.1.0: PF permits Apple Continuity on `llw0` and `bridge100`,
    ///   bidirectional mDNS (5353), RFC1918 LAN, DHCP, and NDP for Sidecar,
    ///   Universal Clipboard, and local network traffic.
    /// - 4.1.0 → 4.2.0: Root helper adds authenticated self-upgrade endpoint
    ///   `/helper/upgrade` to eliminate administrator password prompts on future updates.
    /// - 4.2.0 → 4.3.0: Enforce strict peer bundle confinement and realpath traversal
    ///   refusal on `/helper/upgrade`.
    /// - 4.3.0 → 4.4.0: Protected DNS recovery retains its snapshot and refuses
    ///   release when any service's DNS cannot be read, instead of treating an
    ///   unreadable service as clean. Existing IPC and authorization are unchanged.
    /// - 4.4.0 → 4.5.0: root-owned full-bundle update transaction, detached
    ///   signatures, durable consumption, independent executor and recovery.
    /// - 4.5.0 → 4.6.0: `/dns/status` keeps reporting `snapshotPresent: true`
    ///   (with the snapshot's service) when the snapshot is loadable but its
    ///   network service's current DNS cannot be read, instead of folding
    ///   that into `snapshotPresent: false`. A 4.5.0 daemon hides the snapshot
    ///   and the GUI refuses to call `/dns/restore`, which can otherwise
    ///   succeed for a renamed or removed service.
    /// - 4.6.0 → 4.7.0: an unreadable `protected-dns.json` no longer bricks
    ///   every release outlet. restore()/enable() quarantine a fatally
    ///   invalid snapshot aside and continue snapshotless (the loopback
    ///   sweep runs; original values are not fabricated), and `/dns/status`
    ///   reports such a file as `snapshotPresent: true` so the app calls
    ///   `/dns/restore` instead of refusing. `--emergency-disarm` still
    ///   refuses to open PF while DNS restoration fails.
    /// - 4.7.0 → 4.8.0: startup recovery no longer arms the emergency PF
    ///   barrier when our own update executor's `launchctl bootout` stops the
    ///   daemon while it waits behind the update lock (a reboot inside the
    ///   consumed→replaced window races the two RunAtLoad jobs). That
    ///   SIGTERM is a clean stop — the executor owns the replacement and
    ///   bootstraps this daemon back — while every other startup failure,
    ///   including a corrupt ledger, still installs the fail-closed barrier.
    /// - 4.8.0 → 4.9.0: consumed update transactions gained reachable
    ///   terminal states. `/update/retire` now also archives a blocked,
    ///   rolled-back, expired or abandoned-replacement attempt after the
    ///   owner's verified Disconnect plus an on-disk component proof
    ///   (original or signed target), and `--emergency-disarm` evaluates the
    ///   same predicates after its verified release; the consumed high-water
    ///   mark is never lowered. `reconcile` re-binds the successor grant to a
    ///   freshly authenticated relaunch when the recorded successor is
    ///   provably gone (different boot, or its audit token resolves to no
    ///   live process), allocating a fresh successor generation without
    ///   changing the proof phase. A 4.8.0 daemon keeps both dead ends.
    /// - 4.9.0 → 4.15.0 (merge-train number; 4.10.0–4.14.0 skipped): startup
    ///   restores PF right after reading the allowed user, before the socket
    ///   server's other initialisation; any later startup failure installs
    ///   the emergency block when protection is wanted (a requested stop
    ///   stays clean); and the emergency block falls back to a Tono-owned
    ///   main ruleset when /etc/pf.conf cannot be loaded.
    /// - 4.15.0 → 4.16.0 (merge-train number): the helper
    ///   holds its own `pfctl -E` enable reference (recorded, released on
    ///   disarm) instead of enabling PF only when it was off, supervises PF
    ///   liveness every ten seconds while armed and reinstalls it when it is
    ///   not filtering, and adds the read-only `GET /killswitch/health`
    ///   (`repairedSinceArm`) the connected app polls.
    /// - 4.16.0 → 4.17.0 (merge-train number): the protected DNS snapshot records
    ///   the network service ID next to its display name, and restore
    ///   writes the original servers back by ID. A service renamed while
    ///   protected used to be swept to automatic DNS with its snapshot
    ///   deleted. When the recorded service no longer exists the snapshot is
    ///   archived aside and `/dns/restore` adds `originalDNSRestored: false`;
    ///   an enumeration without IDs keeps the snapshot and refuses release.
    /// - 4.17.0 → 4.19.0 (merge-train number): PF drops DNS (53/853) to LAN
    ///   and link-local ranges while a tunnel is up.
    /// - 4.19.0 → 4.18.0 (merge-train number from the recorded mapping,
    ///   although it merged after 4.19.0; the app compares helper versions
    ///   only for equality): the owned sing-box config check refuses any
    ///   object whose keys repeat after JSON decoding and Go-style case
    ///   folding, and evaluates its allowlist on the folded keys the core
    ///   itself binds. An older daemon validates the first of a repeated key
    ///   while the core runs the last.
    /// - 4.18.0 → 4.20.0 (merge-train number): PF DHCP permit sends only to the limited broadcast and
    ///   the inbound reply permit keeps no state. An older daemon keeps the
    ///   any-destination DHCP permit.
    /// - 4.20.0 → 4.21.0 (merge-train number): `/helper/upgrade` checks the requesting bundle's seal
    ///   and the candidate helper and core against the installer's Developer ID
    ///   requirement. It refuses a helper that is not strictly newer than the
    ///   running one, so older builds need the administrator install.
    /// - 4.21.0 → 4.22.0 (merge-train number): the
    ///   update ledger has a storage major (`schemaVersion`, absent = 1).
    ///   Additive keys from a newer helper are ignored instead of reading as
    ///   a corrupt ledger, and a higher major is refused as newer evidence.
    /// - 4.22.0 → 4.41.0 (merge-train number): `CoreManager` no
    ///   longer resolves the bound user's home directory when it is
    ///   constructed, only when a start or sync validates the config
    ///   directory. `--emergency-disarm` and `--emergency-reset` build one only
    ///   to stop a stale core before releasing PF, so they now work after the
    ///   bound macOS account was deleted. A 4.22.0 daemon's recovery commands
    ///   fail there and leave PF fail-closed.
    /// - 4.41.0 → 4.42.0 (merge-train number): `--emergency-reset`
    ///   takes Tono's marked block back out of /etc/pf.conf and deletes
    ///   /etc/pf.conf.tono-backup and /etc/hosts.tono-backup once PF is
    ///   released, keeping every line outside the markers. A 4.41.0 reset
    ///   leaves the hook and both backups behind.
    /// - 4.42.0 → 4.43.0 (merge-train number): at every start,
    ///   after executor recovery, the daemon checks whether Tono was removed —
    ///   no running Tono client (by the client signing requirement), no Tono
    ///   app in /Applications or the bound user's ~/Applications (by the
    ///   registered name or by bundle identifier; a bundle whose Info.plist
    ///   cannot be read counts as Tono) and no unfinished update attempt.
    ///   Then it performs the `--emergency-reset` release and removal itself
    ///   and unloads its job, instead of re-arming PF at every boot with no
    ///   app left to release it.
    ///   A 4.42.0 daemon keeps a Mac offline after Tono.app is deleted.
    /// - 4.43.0 → 4.44.0 (merge-train number): `--emergency-reset`
    ///   (and the start-time release after Tono.app was removed, which shares
    ///   its removal step) also deletes /var/run/tono-core/service.sock. The
    ///   socket is owned by the account the helper served, and the app reads
    ///   that owner to refuse another account by name; a 4.43.0 reset leaves
    ///   it until reboot.
    /// - 4.44.0 → 4.45.0: PF renders the reviewed-bundle permit
    ///   (`tono-bundle`) only while a tunnel interface is armed; a tunnel-less
    ///   arm that asks for it gets no permit instead of root web-port egress
    ///   on the physical interface. An older daemon renders it on the
    ///   connect's first arm, before the TUN exists.
    /// - 4.45.0 → 4.46.0: `/core/sync`, `/core/stop`, and the idle loop once
    ///   the Core has exited, take the reviewed-bundle permit out of the loaded anchor
    ///   without a state flush while the Core has no utun; the app's next arm
    ///   with the flag restores it once the tunnel exists; if that fails,
    ///   `/core/sync` fails with the old Core still running. An older daemon
    ///   keeps the permit loaded through every Core restart.
    /// - 4.46.0 → 4.47.0: a DNS release no app reply carries (native update
    ///   preparation, `--emergency-disarm`, `--emergency-reset`) records an
    ///   original that had no service to go back to; the next `/dns/restore`
    ///   reply reports `originalDNSRestored: false` once, and the emergency
    ///   commands print it. When the PF enable-reference record cannot be
    ///   written, the helper holds PF with the kernel's one anonymous
    ///   `pfctl -e` reference and releases the new token. A 4.46.0 daemon
    ///   drops that DNS report and, restarting in a loop, leaks one token per
    ///   start.
    /// - 4.47.0 → 4.48.0: every command the helper runs (`pfctl`, the
    ///   relay-map `curl`) has a 15 s deadline, 3 s for a read-only `pfctl`
    ///   query; past it the child gets SIGTERM, then SIGKILL, and the call
    ///   fails like any other command failure. A query with no answer is never
    ///   read as "no": it stops the chain, and nothing is released, forgotten
    ///   or disabled on it. A 4.47.0 daemon waits on a wedged `pfctl` forever,
    ///   holding its single request thread and with it `/core/stop`.
    /// - 4.48.0 → 4.49.0: a `pfctl -E` killed at its deadline is settled only
    ///   once that child has exited, and claims a listed token only when the
    ///   token's age places it inside the child's lifetime, it was not listed
    ///   before the spawn, and the child's exit was reported promptly. When
    ///   the reference record cannot be written and the release of the new
    ///   token gives no answer, the token stays in memory for disarm, as does
    ///   a token a newer record replaced whose release gives no answer (the
    ///   periodic check retries that one). A 4.48.0 daemon can
    ///   claim, and at disarm release, another program's token under a reused
    ///   PID, and forgets both unanswered tokens.
    static let current = "4.49.0"
}

/// The root helper and generated Mihomo runtime must agree on one DNS
/// endpoint. A loopback listener is deliberate: macOS associates DNS servers
/// configured on a network service with that physical interface, so pointing
/// Wi-Fi at a TUN-only address can still send scoped DNS packets out through
/// Wi-Fi. Loopback is unambiguous and remains inside the host.
nonisolated enum ProtectedDNSContract {
    static let server = "127.0.0.1"
    static let port = 53
    static let listener = "\(server):\(port)"
}
