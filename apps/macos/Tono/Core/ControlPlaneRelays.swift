/// The Tono-owned control-plane relays (decision 077), compiled into both the
/// app and the privileged helper so the two can never disagree.
///
/// Each is an nginx `stream` listener with `ssl_preread` that forwards only the
/// SNIs `api.afk.ccwu.cc` and `releases.afk.ccwu.cc`, unterminated, to the
/// Cloudflare edge (`tooling/ops/relay/tono-relay.stream.conf`); the client
/// validates the real API certificate. Decision 086 (H1-F5, owner's Option A):
/// while protection is armed without a tunnel, these endpoints, TCP, for the
/// interactive user, are the helper's only control-plane permit. Literal
/// addresses only: nothing here is ever resolved through DNS. Kept in step
/// with the Windows client's `bootstrap::API_RELAYS` and the control plane's
/// `api-relays.ts`.
nonisolated enum ControlPlaneRelays {
    /// Literal IPv4 address and TCP port of each relay, in the order clients
    /// try them. The third is on another provider and network than the two
    /// DMIT nodes (decision 089), so one provider's outage does not take every
    /// relay with it; it is last so a walk that reaches a DMIT relay is
    /// unchanged.
    static let endpoints: [(address: String, port: UInt16)] = [
        ("179.253.233.220", 2053), // Los Angeles · Westwood
        ("179.255.154.17", 2053), // Los Angeles · Mesa
        ("154.84.56.196", 2053), // Los Angeles · Arosscloud
    ]
}
