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
    static let current = "4.8.0"
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
