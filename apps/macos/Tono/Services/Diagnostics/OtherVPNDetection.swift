import Darwin
import Foundation

/// H21-O-F7: recognise a VPN/TUN interface that Tono does not own.
///
/// Read-only and unprivileged: one `getifaddrs` walk in the app process. It
/// changes no route, PF rule or helper state and never takes part in the
/// connect decision. It only names the likely cause of a failed connect and
/// adds the `otherVpn` class token to the support report.
nonisolated enum OtherVPNDetection {
    /// Class token for `TonoSupportReport.virtualAdapters`. Never an interface name.
    static let diagnosticsClass = "otherVpn"
    /// Mirrors `ConfigPipeline.tonoTunInterface`: the only utun Tono creates.
    static let ownTunnelInterface = "utun199"

    nonisolated struct Interface: Equatable, Sendable {
        let name: String
        let isUp: Bool
        /// An IPv4 address, or an IPv6 address outside fe80::/10. macOS keeps
        /// several system utun interfaces (iCloud, Continuity) up with only an
        /// IPv6 link-local address; a VPN tunnel carries a routable one.
        let hasRoutableAddress: Bool
    }

    static var userMessage: String {
        String(localized: "Another VPN is running on this Mac and may conflict with Tono. Quit it, then connect again.")
    }

    /// `ppp*` is left out on purpose: PPPoE broadband is a ppp interface too,
    /// and it is the uplink, not another VPN.
    private static let tunnelPrefixes = ["utun", "ipsec", "tun", "tap"]

    /// Failures another VPN can plausibly cause: the tunnel, its DNS or the
    /// exit did not work. Helper, account, catalog, update and offline
    /// failures keep their own, more specific sentence.
    private static let attributableCodes: Set<ProtectedFailureCode> = [
        .tunRouteUnavailable, .coreExitUnreachable, .protectedDnsNotReady,
    ]

    static func isForeignVPN(_ interface: Interface) -> Bool {
        guard interface.isUp, interface.hasRoutableAddress,
              interface.name != ownTunnelInterface else { return false }
        return tunnelPrefixes.contains { interface.name.hasPrefix($0) }
    }

    static func isPresent(_ interfaces: [Interface]) -> Bool {
        interfaces.contains(where: isForeignVPN)
    }

    /// The sentence for a classified failure when another VPN is up, or nil
    /// to keep the classified sentence. A clock verdict is never replaced.
    static func attributedMessage(for failure: ProtectedFailure?, interfaces: [Interface]) -> String? {
        guard let failure, attributableCodes.contains(failure.code),
              failure.userMessage != CertificateClock.userMessage,
              isPresent(interfaces) else { return nil }
        return userMessage
    }

    /// Every interface the system lists, one entry per name. Empty when the
    /// walk fails, which means "no attribution", never a guess.
    static func currentInterfaces() -> [Interface] {
        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return [] }
        defer { freeifaddrs(first) }

        var byName: [String: Interface] = [:]
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let entry = cursor {
            cursor = entry.pointee.ifa_next
            let name = String(cString: entry.pointee.ifa_name)
            let isUp = (Int32(entry.pointee.ifa_flags) & IFF_UP) == IFF_UP
            var routable = false
            if let address = entry.pointee.ifa_addr {
                routable = isRoutable(address)
            }
            let previous = byName[name]
            byName[name] = Interface(
                name: name,
                isUp: isUp || previous?.isUp == true,
                hasRoutableAddress: routable || previous?.hasRoutableAddress == true
            )
        }
        return byName.values.sorted { $0.name < $1.name }
    }

    private static func isRoutable(_ address: UnsafeMutablePointer<sockaddr>) -> Bool {
        let family = Int32(address.pointee.sa_family)
        if family == AF_INET { return true }
        guard family == AF_INET6 else { return false }
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(
            address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count),
            nil, 0, NI_NUMERICHOST
        ) == 0 else { return false }
        let text = String(cString: host).lowercased()
        return !["fe8", "fe9", "fea", "feb"].contains { text.hasPrefix($0) }
    }
}
