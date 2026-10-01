import Foundation
import Darwin

/// What one reading of the default uplink means for an already-connected
/// session. PF stays armed in every case. Only `.moved` may tear the tunnel
/// down; a dock, a DHCP gap, or an unreadable store must not.
nonisolated enum UplinkTransition: Equatable, Sendable {
    /// The concrete identity matches. Keep the tunnel.
    case stay
    /// The new reading only fills fields the baseline lacked. Adopt it and
    /// keep the tunnel, so the next real change has something to compare.
    case adopt
    /// The reading went incomplete (store miss, address disappeared, APIPA).
    /// Keep the previous baseline and the tunnel.
    case inconclusive
    /// A concrete field changed to a different concrete value. Rebuild
    /// behind the already-armed barrier.
    case moved
}

/// The default uplink only: service, interface, its IPv4 address and gateway,
/// and the IPv6 default next hop when this Mac has no IPv4 uplink.
///
/// Secondary adapters are absent on purpose. The old physical fingerprint
/// hashed every up IPv4 address, so plugging in a dock changed the fingerprint
/// and `scheduleNetworkEnvironmentReconciliation` stopped the tunnel while
/// Kill Switch was still armed. A Wi-Fi roam that kept the service name and
/// the address but replaced the gateway never changed that fingerprint, so
/// the session kept sockets aimed at the old router.
nonisolated struct NetworkUplinkSnapshot: Equatable, Sendable {
    var primaryService: String?
    var primaryInterface: String?
    var ipv4Address: String?
    var ipv4Gateway: String?
    var ipv6Gateway: String?

    var isConcrete: Bool {
        primaryService != nil || primaryInterface != nil || ipv4Address != nil
            || ipv4Gateway != nil || ipv6Gateway != nil
    }

    /// `protectedService` is the service Protected DNS was written to. It
    /// matters only when the baseline was never captured: a later reading
    /// that names a different service is still a move.
    static func classify(
        from baseline: NetworkUplinkSnapshot?,
        to current: NetworkUplinkSnapshot,
        protectedService: String? = nil
    ) -> UplinkTransition {
        let current = Self.normalized(current)
        guard let baseline = baseline.map(Self.normalized) else {
            if let currentService = current.primaryService,
               let protectedService,
               currentService != protectedService {
                return .moved
            }
            return .adopt
        }
        let fields: [(String?, String?)] = [
            (baseline.primaryService, current.primaryService),
            (baseline.primaryInterface, current.primaryInterface),
            (baseline.ipv4Address, current.ipv4Address),
            (baseline.ipv4Gateway, current.ipv4Gateway),
        ]
        var filledIn = false
        var dropped = false
        for (old, new) in fields {
            switch (old, new) {
            case (nil, nil):
                continue
            case (nil, _?):
                filledIn = true
            case (_?, nil):
                dropped = true
            case let (old?, new?) where old == new:
                continue
            default:
                return .moved
            }
        }
        // Dual-stack RA churn must not black-hole a stable IPv4 uplink.
        // An IPv6-only Mac has no IPv4 address or gateway on either side, so
        // the default next hop is the identity that a roam changes.
        let ipv4Present = baseline.ipv4Address != nil || current.ipv4Address != nil
            || baseline.ipv4Gateway != nil || current.ipv4Gateway != nil
        if !ipv4Present {
            switch (baseline.ipv6Gateway, current.ipv6Gateway) {
            case let (old?, new?) where old != new:
                return .moved
            case (_?, nil):
                dropped = true
            case (nil, _?):
                filledIn = true
            default:
                break
            }
        }
        if dropped { return .inconclusive }
        if filledIn { return .adopt }
        return .stay
    }

    /// Link-local IPv4 (APIPA) is not a new network. Treating it as an address
    /// change tore the tunnel down for the length of a DHCP renewal.
    static func normalized(_ snapshot: NetworkUplinkSnapshot) -> NetworkUplinkSnapshot {
        var snapshot = snapshot
        snapshot.primaryService = nonempty(snapshot.primaryService)
        snapshot.primaryInterface = nonempty(snapshot.primaryInterface)
        snapshot.ipv4Address = usableIPv4(snapshot.ipv4Address)
        snapshot.ipv4Gateway = usableIPv4Gateway(snapshot.ipv4Gateway)
        snapshot.ipv6Gateway = nonempty(snapshot.ipv6Gateway)
        return snapshot
    }

    static func current() -> NetworkUplinkSnapshot {
        guard let observation = SystemNetworkObservation.current() else {
            return NetworkUplinkSnapshot(
                primaryService: nil,
                primaryInterface: nil,
                ipv4Address: nil,
                ipv4Gateway: nil,
                ipv6Gateway: nil
            )
        }
        let interface = observation.ipv4PrimaryInterface ?? observation.ipv6PrimaryInterface
        return NetworkUplinkSnapshot(
            primaryService: observation.primaryServiceName,
            primaryInterface: interface,
            ipv4Address: interface.flatMap(ipv4Address(on:)),
            ipv4Gateway: observation.ipv4Router,
            ipv6Gateway: observation.ipv6Router
        )
    }

    /// First global IPv4 address on `interface`. APIPA is kept here and
    /// stripped by `normalized` so a real address on the same interface wins
    /// when both are present.
    static func ipv4Address(on interface: String) -> String? {
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(first) }
        var fallback: String?
        var ptr: UnsafeMutablePointer<ifaddrs>? = first
        while let current = ptr {
            let name = String(cString: current.pointee.ifa_name)
            if name == interface, let addr = current.pointee.ifa_addr,
               addr.pointee.sa_family == UInt8(AF_INET) {
                var hostname = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(
                    addr,
                    socklen_t(addr.pointee.sa_len),
                    &hostname,
                    socklen_t(hostname.count),
                    nil,
                    0,
                    NI_NUMERICHOST
                ) == 0 {
                    let ip = String(cString: hostname)
                    if usableIPv4(ip) != nil { return ip }
                    if fallback == nil { fallback = ip }
                }
            }
            ptr = current.pointee.ifa_next
        }
        return fallback
    }

    private static func nonempty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    private static func usableIPv4(_ address: String?) -> String? {
        guard let address = nonempty(address), !address.hasPrefix("169.254.") else { return nil }
        return address
    }

    private static func usableIPv4Gateway(_ gateway: String?) -> String? {
        guard let gateway = nonempty(gateway), gateway != "0.0.0.0" else { return nil }
        return gateway
    }
}
