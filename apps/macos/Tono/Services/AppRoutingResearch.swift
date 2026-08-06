import Foundation

nonisolated struct TonoAppRoutingResearchEntry: Codable, Sendable {
    let app: String
    let connectionCount: Int
    let directConnectionCount: Int
    let proxiedConnectionCount: Int
    let blockedConnectionCount: Int
    let trafficVolume: String
}

nonisolated struct TonoAppRoutingResearchSnapshot: Codable, Sendable {
    let schemaVersion: Int
    let snapshotId: String
    let observedSince: Int
    let observedUntil: Int
    let appVersion: String
    let build: String
    let osVersion: String
    let architecture: String
    let observedConnectionCount: Int
    let identifiedAppConnectionCount: Int
    let connectionLimitReached: Bool
    let entries: [TonoAppRoutingResearchEntry]
}

/// Opt-in, privacy-bounded research used only to rank candidates for later
/// human review. Process metadata is classified on-device into a fixed
/// vocabulary and is never persisted or included in a wire model.
nonisolated final class AppRoutingResearch: @unchecked Sendable {
    static let shared = AppRoutingResearch()

    static var isEnabled: Bool {
        AppProfile.defaults.bool(
            forKey: SettingsKey.aggregatedAppRoutingResearchEnabled
        )
    }

    private struct Total: Codable {
        var connections = 0
        var direct = 0
        var proxied = 0
        var blocked = 0
        var bytes: Int64 = 0
    }

    private struct Connection {
        let app: String
        let route: String
        var bytes: Int64
    }

    /// Contains aggregates only. In particular, connection IDs and their local
    /// process attribution are deliberately not encoded.
    private struct Stored: Codable {
        var observedSince: Int
        var totals: [String: Total]
        var limitReached: Bool
        var pending: TonoAppRoutingResearchSnapshot?
    }

    private let queue = DispatchQueue(
        label: "com.raydocs.tono.app-routing-research",
        qos: .utility
    )
    private let fileURL = ConfigStorage.shared.appSupportDirectory
        .appendingPathComponent("app-routing-research.json")
    private var stored: Stored
    /// In-memory dedup state for the controller's full active-connection poll.
    /// It never enters `Stored` or the wire snapshot.
    private var connections: [String: Connection] = [:]
    private var connectionOrder: [String] = []
    private var persistenceWorkItem: DispatchWorkItem?

    private static let observationWindowSeconds = 6 * 60 * 60
    private static let maximumPendingAgeSeconds = 90 * 24 * 60 * 60
    private static let maximumConnections = 20_000
    private static let maximumCount = 1_000_000
    private static let maximumBytes: Int64 = 100_000_000_000_000
    private static let families = Set([
        "wechat", "qq", "feishu", "lark", "dingtalk", "trae", "chrome",
        "edge", "safari", "firefox", "arc", "brave", "claude", "other",
    ])
    private static let trafficVolumes = Set([
        "none", "under_1_mib", "1_to_10_mib", "10_to_100_mib",
        "100_mib_to_1_gib", "1_to_10_gib", "over_10_gib",
    ])

    private init() {
        let timestamp = Int(Date().timeIntervalSince1970)
        stored = Stored(
            observedSince: timestamp,
            totals: [:],
            limitReached: false,
            pending: nil
        )
        guard Self.isEnabled else {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        guard let attributes = try? FileManager.default.attributesOfItem(
            atPath: fileURL.path
        ),
              (attributes[.size] as? NSNumber)?.intValue ?? 0 <= 16 * 1_024,
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode(Stored.self, from: data),
              Self.isValid(decoded, now: timestamp) else {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        stored = decoded
    }

    func setEnabled(_ enabled: Bool) {
        if !enabled {
            disableAndPurge()
            return
        }
        AppProfile.defaults.set(
            true,
            forKey: SettingsKey.aggregatedAppRoutingResearchEnabled
        )
        queue.async { [self] in
            reset(now: Int(Date().timeIntervalSince1970))
            persistNow()
        }
    }

    /// Consent is account-linked. Logout and account-loss paths use this
    /// synchronous barrier so a pending snapshot from one account can never be
    /// inherited and submitted by the next account on the same Mac.
    func disableAndPurge() {
        AppProfile.defaults.set(
            false,
            forKey: SettingsKey.aggregatedAppRoutingResearchEnabled
        )
        queue.sync { [self] in
            reset(now: Int(Date().timeIntervalSince1970))
            try? FileManager.default.removeItem(at: fileURL)
        }
    }

    /// `values` is Mihomo's complete active-connection snapshot. Remove closed
    /// IDs first so cache pressure cannot evict and then repeatedly recount a
    /// still-active connection.
    func record(_ values: [APIConnection]) {
        guard Self.isEnabled else { return }
        queue.async { [self] in
            guard Self.isEnabled else { return }
            let timestamp = Int(Date().timeIntervalSince1970)
            let activeIDs = Set(values.map(\.id))
            connections = connections.filter { activeIDs.contains($0.key) }
            connectionOrder.removeAll { !activeIDs.contains($0) }

            sealElapsedWindowIfNeeded(now: timestamp)

            for value in values {
                let currentBytes = Self.boundedBytes(value)
                if var previous = connections[value.id] {
                    let delta = max(currentBytes - previous.bytes, 0)
                    previous.bytes = max(previous.bytes, currentBytes)
                    connections[value.id] = previous
                    addBytes(delta, to: previous.app)
                    continue
                }

                guard connections.count < Self.maximumConnections else {
                    stored.limitReached = true
                    continue
                }
                let app = Self.family(
                    process: value.metadata.process,
                    path: value.metadata.processPath
                )
                let route = Self.route(value)
                addConnection(app: app, route: route, bytes: currentBytes)
                connections[value.id] = Connection(
                    app: app,
                    route: route,
                    bytes: currentBytes
                )
                connectionOrder.append(value.id)
            }
            schedulePersistence()
        }
    }

    /// Returns the one sealed, idempotent snapshot. A failed upload never grows
    /// that payload: later six-hour windows are reset (and intentionally dropped
    /// while the one pending slot is occupied) instead of being merged without
    /// bound.
    func readySnapshot() async -> TonoAppRoutingResearchSnapshot? {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                guard Self.isEnabled else {
                    continuation.resume(returning: nil)
                    return
                }
                let timestamp = Int(Date().timeIntervalSince1970)
                discardExpiredPending(now: timestamp)
                sealElapsedWindowIfNeeded(now: timestamp)
                continuation.resume(returning: stored.pending)
            }
        }
    }

    func acknowledge(snapshotId: String) {
        queue.async { [self] in
            guard stored.pending?.snapshotId == snapshotId else { return }
            stored.pending = nil
            persistNow()
        }
    }

    private func sealElapsedWindowIfNeeded(now timestamp: Int) {
        discardExpiredPending(now: timestamp)
        guard timestamp >= stored.observedSince + Self.observationWindowSeconds else {
            return
        }

        let totalConnections = Self.totalConnections(stored.totals)
        let windowEnd = stored.observedSince + Self.observationWindowSeconds
        if stored.pending == nil, totalConnections > 0,
           windowEnd >= timestamp - Self.maximumPendingAgeSeconds {
            // Always emit an exactly bounded window even after sleep/offline
            // time. Any newly observed connections are processed only after this
            // seal and therefore belong to the fresh current window.
            stored.pending = snapshot(until: windowEnd)
        }

        // Preserve active byte baselines in memory and count each still-active
        // connection once in the new observation window. No identity is copied
        // into the persisted aggregate.
        stored.observedSince = timestamp
        stored.totals.removeAll(keepingCapacity: true)
        stored.limitReached = false
        for connection in connections.values {
            addConnection(app: connection.app, route: connection.route, bytes: 0)
        }
        persistNow()
    }

    private func discardExpiredPending(now timestamp: Int) {
        guard let pending = stored.pending,
              pending.observedUntil < timestamp - Self.maximumPendingAgeSeconds else {
            return
        }
        stored.pending = nil
    }

    private func addConnection(app: String, route: String, bytes: Int64) {
        guard Self.totalConnections(stored.totals) < Self.maximumCount else {
            stored.limitReached = true
            return
        }
        var total = stored.totals[app] ?? Total()
        total.connections += 1
        switch route {
        case "direct": total.direct += 1
        case "blocked": total.blocked += 1
        default: total.proxied += 1
        }
        total.bytes = Self.boundedSum(total.bytes, bytes)
        stored.totals[app] = total
    }

    private func addBytes(_ bytes: Int64, to app: String) {
        guard bytes > 0 else { return }
        var total = stored.totals[app] ?? Total()
        total.bytes = Self.boundedSum(total.bytes, bytes)
        stored.totals[app] = total
    }

    private func snapshot(until: Int) -> TonoAppRoutingResearchSnapshot? {
        guard let appVersion = Bundle.main.object(
            forInfoDictionaryKey: "CFBundleShortVersionString"
        ) as? String,
              Self.isReleaseVersion(appVersion),
              let build = Bundle.main.object(
                forInfoDictionaryKey: "CFBundleVersion"
              ) as? String,
              Self.isNumericBuild(build) else { return nil }

        let entries = stored.totals.compactMap {
            app, total -> TonoAppRoutingResearchEntry? in
            guard total.connections > 0 else { return nil }
            return TonoAppRoutingResearchEntry(
                app: app,
                connectionCount: total.connections,
                directConnectionCount: total.direct,
                proxiedConnectionCount: total.proxied,
                blockedConnectionCount: total.blocked,
                trafficVolume: Self.bucket(total.bytes)
            )
        }.sorted { $0.app < $1.app }
        let observed = entries.reduce(0) { $0 + $1.connectionCount }
        let identified = entries.filter { $0.app != "other" }
            .reduce(0) { $0 + $1.connectionCount }
        let version = ProcessInfo.processInfo.operatingSystemVersion
        #if arch(arm64)
        let architecture = "arm64"
        #elseif arch(x86_64)
        let architecture = "x86_64"
        #else
        return nil
        #endif
        return TonoAppRoutingResearchSnapshot(
            schemaVersion: 1,
            snapshotId: UUID().uuidString.lowercased(),
            observedSince: stored.observedSince,
            observedUntil: until,
            appVersion: appVersion,
            build: build,
            osVersion: "\(version.majorVersion).\(version.minorVersion)",
            architecture: architecture,
            observedConnectionCount: observed,
            identifiedAppConnectionCount: identified,
            connectionLimitReached: stored.limitReached,
            entries: entries
        )
    }

    private func schedulePersistence() {
        guard persistenceWorkItem == nil else { return }
        let item = DispatchWorkItem { [weak self] in
            guard let self else { return }
            self.persistenceWorkItem = nil
            self.persistNow()
        }
        persistenceWorkItem = item
        queue.asyncAfter(deadline: .now() + 60, execute: item)
    }

    private func persistNow() {
        guard Self.isEnabled else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(stored), data.count <= 16 * 1_024 else {
            return
        }
        try? ConfigStorage.shared.writeSensitive(data, to: fileURL)
    }

    private func reset(now timestamp: Int) {
        persistenceWorkItem?.cancel()
        persistenceWorkItem = nil
        connections.removeAll(keepingCapacity: true)
        connectionOrder.removeAll(keepingCapacity: true)
        stored = Stored(
            observedSince: timestamp,
            totals: [:],
            limitReached: false,
            pending: nil
        )
    }

    private static func boundedBytes(_ value: APIConnection) -> Int64 {
        boundedSum(
            min(max(value.upload, 0), maximumBytes),
            min(max(value.download, 0), maximumBytes)
        )
    }

    private static func boundedSum(_ left: Int64, _ right: Int64) -> Int64 {
        let boundedLeft = min(max(left, 0), maximumBytes)
        let boundedRight = min(max(right, 0), maximumBytes)
        return boundedLeft > maximumBytes - boundedRight
            ? maximumBytes
            : boundedLeft + boundedRight
    }

    private static func totalConnections(_ totals: [String: Total]) -> Int {
        totals.values.reduce(0) {
            min($0 + $1.connections, maximumCount)
        }
    }

    private static func bucket(_ bytes: Int64) -> String {
        if bytes == 0 { return "none" }
        if bytes < 1_048_576 { return "under_1_mib" }
        if bytes < 10 * 1_048_576 { return "1_to_10_mib" }
        if bytes < 100 * 1_048_576 { return "10_to_100_mib" }
        if bytes < 1_073_741_824 { return "100_mib_to_1_gib" }
        if bytes < 10 * 1_073_741_824 { return "1_to_10_gib" }
        return "over_10_gib"
    }

    private static func route(_ value: APIConnection) -> String {
        let chains = value.chains.map { $0.uppercased() }
        let rule = value.rule.uppercased()
        if rule.hasPrefix("REJECT")
            || chains.contains(where: { $0.hasPrefix("REJECT") }) {
            return "blocked"
        }
        if rule == "DIRECT" || chains.contains("DIRECT")
            || chains.contains(ConfigPipeline.directProxyName.uppercased())
            || chains.contains(ConfigPipeline.webDirectProxyName.uppercased()) {
            return "direct"
        }
        return "proxied"
    }

    private static func family(process: String?, path: String?) -> String {
        let name = (process ?? "").lowercased()
        let bundlePath = (path ?? "").lowercased()
        func inBundle(_ bundle: String) -> Bool {
            bundlePath.contains("/\(bundle.lowercased()).app/")
        }
        if inBundle("WeChat") || inBundle("Weixin")
            || name.hasPrefix("wechat") || name.hasPrefix("weixin") {
            return "wechat"
        }
        if inBundle("QQ") || name == "qq" || name.hasPrefix("qq helper") {
            return "qq"
        }
        if inBundle("Feishu") || name.hasPrefix("feishu") { return "feishu" }
        if inBundle("Lark") || name.hasPrefix("lark") { return "lark" }
        if inBundle("DingTalk") || name.hasPrefix("dingtalk") { return "dingtalk" }
        if inBundle("Trae") || name.hasPrefix("trae") { return "trae" }
        if inBundle("Google Chrome") || name.hasPrefix("google chrome") {
            return "chrome"
        }
        if inBundle("Microsoft Edge") || name.hasPrefix("microsoft edge") {
            return "edge"
        }
        if inBundle("Safari") || name.hasPrefix("safari") { return "safari" }
        if inBundle("Firefox") || name.hasPrefix("firefox") { return "firefox" }
        if inBundle("Arc") || name == "arc" || name.hasPrefix("arc helper") {
            return "arc"
        }
        if inBundle("Brave Browser") || name.hasPrefix("brave browser") {
            return "brave"
        }
        if inBundle("Claude") || name == "claude"
            || bundlePath.hasSuffix("/claude") {
            return "claude"
        }
        return "other"
    }

    private static func isReleaseVersion(_ value: String) -> Bool {
        value.utf8.count <= 40 && value.range(
            of: #"^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9][a-z0-9.-]{0,19})?$"#,
            options: .regularExpression
        ) != nil
    }

    private static func isNumericBuild(_ value: String) -> Bool {
        value.range(of: #"^(?:0|[1-9]\d{0,9})$"#, options: .regularExpression) != nil
    }

    private static func isValid(_ value: Stored, now timestamp: Int) -> Bool {
        guard value.observedSince >= 0,
              value.observedSince <= timestamp + 300,
              value.observedSince >= timestamp - maximumPendingAgeSeconds,
              value.totals.count <= families.count,
              Set(value.totals.keys).isSubset(of: families) else { return false }
        var allConnections = 0
        for total in value.totals.values {
            guard total.connections >= 0, total.connections <= maximumCount,
                  total.direct >= 0, total.proxied >= 0, total.blocked >= 0,
                  total.direct + total.proxied + total.blocked == total.connections,
                  total.bytes >= 0, total.bytes <= maximumBytes else { return false }
            allConnections += total.connections
            guard allConnections <= maximumCount else { return false }
        }
        guard let pending = value.pending else { return true }
        return isValid(pending, now: timestamp)
    }

    private static func isValid(
        _ snapshot: TonoAppRoutingResearchSnapshot,
        now timestamp: Int
    ) -> Bool {
        guard snapshot.schemaVersion == 1,
              UUID(uuidString: snapshot.snapshotId) != nil,
              snapshot.observedSince >= 0,
              snapshot.observedUntil - snapshot.observedSince
                == observationWindowSeconds,
              snapshot.observedUntil <= timestamp + 300,
              snapshot.observedUntil >= timestamp - maximumPendingAgeSeconds,
              isReleaseVersion(snapshot.appVersion),
              isNumericBuild(snapshot.build),
              snapshot.osVersion.range(
                of: #"^\d{1,3}\.\d{1,3}$"#,
                options: .regularExpression
              ) != nil,
              ["arm64", "x86_64"].contains(snapshot.architecture),
              snapshot.entries.count >= 1,
              snapshot.entries.count <= families.count else { return false }
        var apps = Set<String>()
        var observed = 0
        var identified = 0
        for entry in snapshot.entries {
            guard families.contains(entry.app), apps.insert(entry.app).inserted,
                  trafficVolumes.contains(entry.trafficVolume),
                  entry.connectionCount >= 1,
                  entry.directConnectionCount >= 0,
                  entry.proxiedConnectionCount >= 0,
                  entry.blockedConnectionCount >= 0,
                  entry.directConnectionCount + entry.proxiedConnectionCount
                    + entry.blockedConnectionCount == entry.connectionCount else {
                return false
            }
            observed += entry.connectionCount
            if entry.app != "other" { identified += entry.connectionCount }
            guard observed <= maximumCount else { return false }
        }
        return observed == snapshot.observedConnectionCount
            && identified == snapshot.identifiedAppConnectionCount
    }
}
