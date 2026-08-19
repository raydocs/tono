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
    static let current = "3.13.0"
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
