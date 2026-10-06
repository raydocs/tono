import Foundation

/// Only the expanded row is bounded; the existing Connections tab retains its
/// full filtered, virtualized list and close controls.
@MainActor enum SeaActivityPresentation {
    static let expandedConnectionLimit = 20

    static func currentConnections(
        _ entries: [ConnectionEntry], for appID: String
    ) -> [ConnectionEntry] {
        Array(entries.lazy.filter {
            ($0.processName ?? AppTrafficLedger.unattributed) == appID
        }.prefix(expandedConnectionLimit))
    }
}
