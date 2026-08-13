import Foundation

/// Per-application traffic totals, split by which path the bytes took.
///
/// Mihomo reports only *live* connections, and a connection's byte counters
/// vanish the moment it closes — so a snapshot of `/connections` answers "what
/// is open now" and nothing at all about "what has this app used". The ledger
/// closes that gap by diffing each connection's counters against their previous
/// value and banking the delta against the process, which means a closed
/// connection's bytes survive in the total.
///
/// The route split is the part worth having and the part Surge cannot show: the
/// same question that took two customer log files and four throwaway scripts to
/// answer — is WeChat actually going direct — becomes a coloured bar the user
/// reads themselves.
@MainActor
@Observable
final class AppTrafficLedger {
    /// Bytes attributed to one path class. Totals, not rates: a rate belongs to
    /// the traffic stream, which already publishes it.
    struct RouteSplit: Equatable {
        var direct: Int64 = 0
        var residential: Int64 = 0
        var tunnel: Int64 = 0
        var blocked: Int64 = 0

        var total: Int64 { direct + residential + tunnel + blocked }

        mutating func add(_ bytes: Int64, to routeClass: RouteClass) {
            switch routeClass {
            case .direct: direct += bytes
            case .residential: residential += bytes
            case .tunnel: tunnel += bytes
            case .blocked: blocked += bytes
            }
        }
    }

    enum RouteClass {
        case direct
        /// Chained through the residential hop. It leaves via the exit too, but
        /// the egress identity — and what the user is paying for — is the
        /// residential address, so it is its own class rather than "tunnel".
        case residential
        case tunnel
        case blocked
    }

    struct AppTotals: Identifiable, Equatable {
        /// Process name as Mihomo reports it, or `unattributed` when it reports
        /// none. Also the row identity, which is why it is never empty.
        let id: String
        var upload: Int64 = 0
        var download: Int64 = 0
        var split = RouteSplit()
        var liveConnections: Int = 0

        var total: Int64 { upload + download }
    }

    /// Mihomo answers with no process for its own probes and for flows whose
    /// owner exited before it looked. Grouping them under a named bucket keeps
    /// the column totals honest instead of dropping the bytes.
    static let unattributed = "Unattributed"

    /// Distinct processes tracked before new names are folded into
    /// `unattributed`. Far above any real machine; a backstop against a
    /// pathological process-name source growing the table without bound.
    static let maximumTrackedProcesses = 300

    private(set) var apps: [AppTotals] = []
    private(set) var startedAt = Date()
    /// Sum over every tracked process, so the header card does not have to
    /// re-add the table on each update.
    private(set) var overall = RouteSplit()

    private var totals: [String: AppTotals] = [:]
    /// Last counters seen per live connection id, so a delta can be taken.
    private var counters: [String: (upload: Int64, download: Int64)] = [:]

    func reset() {
        totals = [:]
        counters = [:]
        apps = []
        overall = RouteSplit()
        startedAt = Date()
    }

    /// Folds one `/connections` snapshot into the totals.
    ///
    /// Must be called for every snapshot, not only while the Activity page is
    /// on screen: a ledger fed only when someone is looking would show totals
    /// that depend on where the user was navigating, which is worse than
    /// showing none.
    func ingest(_ connections: [APIConnection]) {
        var live = Set<String>()
        live.reserveCapacity(connections.count)
        for connection in connections {
            live.insert(connection.id)
            let previous = counters[connection.id]
            // A counter that went backwards means the id was reused, so the
            // current value is the whole of the new connection rather than a
            // delta against a stranger's total.
            let uploadDelta = previous.map { connection.upload >= $0.upload
                ? connection.upload - $0.upload
                : connection.upload } ?? connection.upload
            let downloadDelta = previous.map { connection.download >= $0.download
                ? connection.download - $0.download
                : connection.download } ?? connection.download
            counters[connection.id] = (connection.upload, connection.download)

            let key = processKey(for: connection)
            var entry = totals[key] ?? AppTotals(id: key)
            entry.upload += uploadDelta
            entry.download += downloadDelta
            let routeClass = Self.routeClass(for: connection)
            entry.split.add(uploadDelta + downloadDelta, to: routeClass)
            overall.add(uploadDelta + downloadDelta, to: routeClass)
            totals[key] = entry
        }
        // Closed connections: their bytes are already banked, so only the cursor
        // has to go. Dropping it is what keeps this dictionary bounded by the
        // number of open connections rather than by uptime.
        if counters.count > live.count {
            counters = counters.filter { live.contains($0.key) }
        }
        recountLiveConnections(connections)
        apps = totals.values
            .filter { $0.total > 0 || $0.liveConnections > 0 }
            .sorted {
                $0.total == $1.total ? $0.id < $1.id : $0.total > $1.total
            }
    }

    private func recountLiveConnections(_ connections: [APIConnection]) {
        for key in totals.keys {
            totals[key]?.liveConnections = 0
        }
        for connection in connections {
            let key = processKey(for: connection)
            totals[key]?.liveConnections += 1
        }
    }

    private func processKey(for connection: APIConnection) -> String {
        guard let process = connection.metadata.process, !process.isEmpty else {
            return Self.unattributed
        }
        let grouped = Self.groupedProcessName(
            process: process,
            processPath: connection.metadata.processPath
        )
        if totals[grouped] != nil { return grouped }
        guard totals.count < Self.maximumTrackedProcesses else {
            return Self.unattributed
        }
        return grouped
    }

    /// Collapse Claude desktop helpers and Claude Code's versioned launcher
    /// (`2.1.223`) so Activity does not grow one row per helper and per
    /// upgrade. A miss still keeps the raw process name.
    static func groupedProcessName(process: String, processPath: String?) -> String {
        let path = processPath ?? ""
        if ConfigPipeline.isClaudeCodeIdentity(process: process, processPath: path) {
            return "Claude Code"
        }
        if ConfigPipeline.isClaudeAppIdentity(process: process, processPath: path) {
            return "Claude"
        }
        if Self.isWeChatIdentity(process: process, processPath: path) {
            return "WeChat"
        }
        if Self.isChatGPTIdentity(process: process, processPath: path) {
            return "ChatGPT"
        }
        return process
    }

    private static func isWeChatIdentity(process: String, processPath: String) -> Bool {
        let path = processPath.lowercased()
        if path.contains("/wechat.app/") || path.contains("/微信.app/") {
            return true
        }
        switch process.lowercased() {
        case "wechat", "weixin", "wechatappex", "wechathelper",
             "wechat helper", "wechat networkservice", "wxplayer", "wxocr":
            return true
        default:
            return process.hasPrefix("WeChat")
        }
    }

    private static func isChatGPTIdentity(process: String, processPath: String) -> Bool {
        let path = processPath.lowercased()
        if path.contains("/chatgpt.app/") { return true }
        return process == "ChatGPT" || process.hasPrefix("ChatGPT Helper")
            || process == "chatgpt" || process == "ChatGPT.exe"
    }

    /// Classifies a connection by the path its bytes actually took.
    ///
    /// Reads the proxy chain rather than the rule: a rule names a *group*, and a
    /// fallback group's decision is exactly what the chain records and the rule
    /// does not. `Tono-China-App` appears on both a direct flow and one that
    /// failed over to the exit; only the chain tells them apart.
    nonisolated static func routeClass(for connection: APIConnection) -> RouteClass {
        if connection.rule == "REJECT" || connection.chains.contains("REJECT") {
            return .blocked
        }
        // What matters is that this precedes the `.tunnel` fallthrough, not that
        // it precedes the direct names: a residential chain carries the exit it
        // was dialled through and never a direct outbound, so without this test
        // every residential byte would be filed as ordinary tunnel traffic and
        // the exit the customer is paying for would be invisible.
        if connection.chains.contains(ConfigPipeline.homeResidentialProxyName) {
            return .residential
        }
        // homeProxy (a catalog node, not the chained SOCKS5) never names
        // Tono-Home-Residential. The healthy chain is `HomeNode →
        // Tono-Claude-Home`. Failover inserts Tono-Exit, and those bytes
        // really did leave through the datacenter, so they stay tunnel.
        if connection.chains.contains(ConfigPipeline.claudeHomeGroupName)
            && !connection.chains.contains(ConfigPipeline.exitGroupName) {
            return .residential
        }
        if connection.chains.contains(ConfigPipeline.directProxyName)
            || connection.chains.contains(ConfigPipeline.webDirectProxyName)
            || connection.chains.contains("DIRECT")
            || connection.chains.isEmpty {
            return .direct
        }
        return .tunnel
    }
}
