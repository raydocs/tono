/// Which network service the privileged helper's `/dns/enable` writes. Shared
/// with the separately compiled helper (listed in
/// `tooling/scripts/build-core-helper.sh`); pure, no System Configuration I/O.
///
/// R3-O5: the app names the service by display name, and every Network
/// Location carries its own copy of each service under its own ID.
/// `SCNetworkServiceCopyAll` returns the copies of every location, so taking
/// the first "Wi-Fi" could point an unused location's Wi-Fi at Tono's
/// resolver while the live Wi-Fi kept its LAN resolver. Only the current
/// location's services are candidates, and the primary service ID the app
/// took the name from wins over any other service with that name.
nonisolated enum ProtectedDNSServiceIdentity {
    struct Candidate: Equatable, Sendable {
        let id: String
        let name: String
    }

    /// The one service ID `enable` may write, or nil when `name` does not
    /// pick exactly one service of the current location. `services` is every
    /// service in the preferences, all locations included;
    /// `currentLocationIDs` are the IDs of the current network set's members.
    /// `primaryServiceIDs` are the dynamic store's IPv4 then IPv6
    /// `PrimaryService`, the keys the app read the name from. Nil makes
    /// `enable` refuse before any DNS I/O.
    static func select(
        named name: String,
        services: [Candidate],
        currentLocationIDs: Set<String>,
        primaryServiceIDs: [String]
    ) -> String? {
        let matches = Set(
            services
                .filter {
                    $0.name == name && !$0.id.isEmpty
                        && currentLocationIDs.contains($0.id)
                }
                .map(\.id)
        )
        if let primary = primaryServiceIDs.first(where: { matches.contains($0) }) {
            return primary
        }
        return matches.count == 1 ? matches.first : nil
    }
}
