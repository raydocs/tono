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
    static let current = "3.9.0"
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
