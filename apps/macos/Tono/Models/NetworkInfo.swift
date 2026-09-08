// MARK: - Network Info

struct NetworkInfo {
    var ip: String = "--"
    /// Network operator behind the exit address, from the lookup's ASN owner.
    ///
    /// Replaces the old `asType`, which read a nested `asn.type` field the
    /// provider stopped returning: the response is flat now, so every client
    /// displayed "--" for it. Naming the operator is also the more useful fact —
    /// it is what a support conversation can act on.
    var org: String = "--"
    /// Country code. The provider no longer returns a city on this endpoint, so
    /// claiming one would be inventing it.
    var location: String = "--"
}

// MARK: - Traffic Stats

struct TrafficStats {
    var uploadSpeed: Int64 = 0
    var downloadSpeed: Int64 = 0
    var totalUpload: Int64 = 0
    var totalDownload: Int64 = 0
    var activeConnections: Int = 0
}
