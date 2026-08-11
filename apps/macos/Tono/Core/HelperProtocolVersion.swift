/// One shared install/runtime contract for both the GUI and the separately
/// compiled privileged helper. Keeping the value in one source file prevents
/// the app from silently accepting an older helper after its PF behavior
/// changes.
nonisolated enum HelperProtocolVersion {
    /// 3.6.0 — the helper's PF rendering and its IPC client requirement both
    /// changed: the control-plane bootstrap permit is now restricted to
    /// `user { 0, <allowedUID> }`, and a client carrying `get-task-allow` is
    /// refused. `HelperManager.prepare` decides whether to reinstall by
    /// comparing this string alone, so leaving it at 3.5.0 would have let every
    /// existing install keep its old daemon indefinitely: the app would report
    /// `helper_already_current`, the hardened requirement and the narrowed PF
    /// permit would never reach anyone who upgrades, and a verification pass
    /// would look clean while testing none of it.
    static let current = "3.6.0"
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
