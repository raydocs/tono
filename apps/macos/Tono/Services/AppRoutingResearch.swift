import CryptoKit
import Foundation

nonisolated struct TonoAppRoutingResearchEntry: Codable, Sendable {
    let app: String
    let connectionCount: Int
    let directConnectionCount: Int
    let proxiedConnectionCount: Int
    let blockedConnectionCount: Int
    let trafficVolume: String
}

/// Privacy-safe process-path detail. The raw absolute process path is reduced
/// on-device to one of five fixed bundle-relative component categories. This
/// is detailed enough to distinguish main-app traffic from helper/XPC/plugin
/// traffic without transmitting usernames, install locations or executable
/// names.
nonisolated struct TonoAppRoutingResearchComponentEntry: Codable, Sendable {
    let app: String
    let bundleComponent: String
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
    /// Present and required for schema v2. Optional decoding preserves an
    /// already-sealed schema-v1 snapshot across an app update.
    let bundleComponents: [TonoAppRoutingResearchComponentEntry]?
}

nonisolated struct TonoAppRoutingResearchUploadLease: Sendable {
    let snapshot: TonoAppRoutingResearchSnapshot
    let ownerHash: String
    fileprivate let generation: UInt64
}

/// Privacy-bounded research used only to rank candidates for later human
/// review. It defaults on, remains user-disableable, and is runtime-gated to a
/// ready authenticated account. Process metadata is classified on-device into
/// fixed vocabularies; raw metadata is never persisted or included in a wire
/// model.
nonisolated final class AppRoutingResearch: @unchecked Sendable {
    static let shared = AppRoutingResearch()

    static var isEnabled: Bool {
        AppProfile.defaults.object(
            forKey: SettingsKey.aggregatedAppRoutingResearchEnabled
        ) as? Bool ?? true
    }

    static var isCollectionActive: Bool {
        shared.queue.sync { shared.collectionActive }
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
        let bundleComponent: String?
        let route: String
        var bytes: Int64
    }

    /// Contains aggregates only. In particular, connection IDs and their local
    /// process attribution are deliberately not encoded.
    private struct Stored: Codable {
        var ownerHash: String?
        var observedSince: Int
        var totals: [String: Total]
        var componentTotals: [String: Total]
        var limitReached: Bool
        var pending: TonoAppRoutingResearchSnapshot?

        init(
            ownerHash: String?,
            observedSince: Int,
            totals: [String: Total],
            componentTotals: [String: Total],
            limitReached: Bool,
            pending: TonoAppRoutingResearchSnapshot?
        ) {
            self.ownerHash = ownerHash
            self.observedSince = observedSince
            self.totals = totals
            self.componentTotals = componentTotals
            self.limitReached = limitReached
            self.pending = pending
        }

        private enum CodingKeys: String, CodingKey {
            case ownerHash, observedSince, totals, componentTotals, limitReached
            case pending
        }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            ownerHash = try values.decodeIfPresent(String.self, forKey: .ownerHash)
            observedSince = try values.decode(Int.self, forKey: .observedSince)
            totals = try values.decode([String: Total].self, forKey: .totals)
            componentTotals = try values.decodeIfPresent(
                [String: Total].self,
                forKey: .componentTotals
            ) ?? [:]
            limitReached = try values.decode(Bool.self, forKey: .limitReached)
            pending = try values.decodeIfPresent(
                TonoAppRoutingResearchSnapshot.self,
                forKey: .pending
            )
        }
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
    /// The account identifier never enters storage. Only its SHA-256 digest is
    /// retained locally to prevent a crash-restored aggregate from crossing to
    /// a different account. `collectionActive` is the synchronous runtime gate
    /// checked by every producer and uploader.
    private var activeOwnerHash: String?
    private var runtimeReady = false
    private var collectionActive = false
    private var activationGeneration: UInt64 = 0
    private var needsConnectionBaseline = true

    private static let observationWindowSeconds = 6 * 60 * 60
    private static let maximumPendingAgeSeconds = 90 * 24 * 60 * 60
    private static let maximumConnections = 20_000
    private static let maximumCount = 1_000_000
    private static let maximumBytes: Int64 = 100_000_000_000_000
    /// Keep every wire payload below the control plane's 8 KiB canonical JSON
    /// limit even when every count and platform field has its maximum width.
    private static let maximumSnapshotEntries = 20
    private static let maximumSnapshotComponentEntries = 16
    /// A build-41 pending snapshot can contain up to 25 component entries. Keep
    /// accepting it across the update even though new snapshots use a tighter
    /// cap after the recognized-app vocabulary expands.
    private static let maximumAcceptedComponentEntries = 25
    /// The control plane reads this payload with an 8 KiB body limit and rejects a
    /// canonical form above the same bound, so a snapshot that does not fit can
    /// never be delivered. Entry caps alone do not establish that: 20 entries plus
    /// 25 legacy component entries at full count and platform width serialize to
    /// roughly 9.4 KiB. Since there is one pending slot and expiry is ninety days,
    /// an oversized snapshot would silently block every later upload for a quarter
    /// of a year, so size is checked directly rather than inferred from counts.
    private static let maximumSnapshotWireBytes = 8 * 1_024
    private static let maximumStoredBytes = 32 * 1_024
    private static let families = AppRoutingResearchClassifier.families
    private static let componentFamilies =
        AppRoutingResearchClassifier.componentFamilies
    private static let bundleComponents =
        AppRoutingResearchClassifier.bundleComponents
    private static let trafficVolumes = Set([
        "none", "under_1_mib", "1_to_10_mib", "10_to_100_mib",
        "100_mib_to_1_gib", "1_to_10_gib", "over_10_gib",
    ])

    private init() {
        let timestamp = Int(Date().timeIntervalSince1970)
        stored = Stored(
            ownerHash: nil,
            observedSince: timestamp,
            totals: [:],
            componentTotals: [:],
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
              (attributes[.size] as? NSNumber)?.intValue ?? 0
                <= Self.maximumStoredBytes,
              let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode(Stored.self, from: data),
              Self.isValid(decoded, now: timestamp) else {
            try? FileManager.default.removeItem(at: fileURL)
            return
        }
        stored = decoded
    }

    /// Updates the installation-level preference. A missing key means enabled,
    /// while an explicit opt-out remains false across app and account changes.
    /// Enabling cannot collect signed-out traffic: collection starts only when
    /// `activate(forAuthenticatedUser:)` has established the ready account.
    func setEnabled(_ enabled: Bool) {
        AppProfile.defaults.set(
            enabled,
            forKey: SettingsKey.aggregatedAppRoutingResearchEnabled
        )
        queue.sync { [self] in
            invalidateActivation()
            let timestamp = Int(Date().timeIntervalSince1970)
            if enabled, runtimeReady, let activeOwnerHash {
                reset(now: timestamp, ownerHash: activeOwnerHash)
                collectionActive = true
                persistNow()
            } else {
                collectionActive = false
                reset(now: timestamp, ownerHash: nil)
                try? FileManager.default.removeItem(at: fileURL)
            }
        }
    }

    /// Establishes the authenticated runtime gate. A digest mismatch purges the
    /// crash-restored aggregate synchronously before collection or upload can
    /// begin for the new account.
    func activate(forAuthenticatedUser userID: String) {
        let ownerHash = Self.ownerHash(userID)
        queue.sync { [self] in
            invalidateActivation()
            activeOwnerHash = ownerHash
            runtimeReady = true
            guard Self.isEnabled else {
                collectionActive = false
                reset(now: Int(Date().timeIntervalSince1970), ownerHash: nil)
                try? FileManager.default.removeItem(at: fileURL)
                return
            }
            if stored.ownerHash != ownerHash {
                reset(
                    now: Int(Date().timeIntervalSince1970),
                    ownerHash: ownerHash
                )
                try? FileManager.default.removeItem(at: fileURL)
                persistNow()
            }
            collectionActive = true
        }
    }

    /// Temporarily stops collection/upload when the authenticated runtime is
    /// not ready (including sleep and recoverable errors), preserving the same
    /// account's bounded aggregate for a later ready transition.
    func pause() {
        queue.sync {
            invalidateActivation()
            runtimeReady = false
            collectionActive = false
            needsConnectionBaseline = true
        }
    }

    /// Logout and account-loss paths use this synchronous barrier so a pending
    /// snapshot from one account can never be inherited or submitted by the
    /// next account. The user's installation-level preference is preserved.
    func deactivateAndPurge() {
        queue.sync { [self] in
            invalidateActivation()
            activeOwnerHash = nil
            runtimeReady = false
            collectionActive = false
            reset(now: Int(Date().timeIntervalSince1970), ownerHash: nil)
            try? FileManager.default.removeItem(at: fileURL)
        }
    }

    /// `values` is Mihomo's complete active-connection snapshot. Remove closed
    /// IDs first so cache pressure cannot evict and then repeatedly recount a
    /// still-active connection.
    func record(_ values: [APIConnection]) {
        guard Self.isCollectionActive else { return }
        queue.async { [self] in
            guard collectionActive, Self.isEnabled,
                  stored.ownerHash == activeOwnerHash else { return }
            let timestamp = Int(Date().timeIntervalSince1970)
            let activeIDs = Set(values.map(\.id))
            connections = connections.filter { activeIDs.contains($0.key) }
            connectionOrder.removeAll { !activeIDs.contains($0) }

            sealElapsedWindowIfNeeded(now: timestamp)

            if needsConnectionBaseline {
                for value in values {
                    let currentBytes = Self.boundedBytes(value)
                    if var previous = connections[value.id] {
                        previous.bytes = currentBytes
                        connections[value.id] = previous
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
                    let component = Self.bundleComponent(
                        for: app,
                        processPath: value.metadata.processPath
                    )
                    let route = Self.route(value)
                    addConnection(
                        app: app,
                        bundleComponent: component,
                        route: route,
                        bytes: 0
                    )
                    connections[value.id] = Connection(
                        app: app,
                        bundleComponent: component,
                        route: route,
                        bytes: currentBytes
                    )
                    connectionOrder.append(value.id)
                }
                needsConnectionBaseline = false
                schedulePersistence()
                return
            }

            for value in values {
                let currentBytes = Self.boundedBytes(value)
                if var previous = connections[value.id] {
                    let delta = max(currentBytes - previous.bytes, 0)
                    previous.bytes = max(previous.bytes, currentBytes)
                    connections[value.id] = previous
                    addBytes(
                        delta,
                        to: previous.app,
                        bundleComponent: previous.bundleComponent
                    )
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
                let component = Self.bundleComponent(
                    for: app,
                    processPath: value.metadata.processPath
                )
                let route = Self.route(value)
                addConnection(
                    app: app,
                    bundleComponent: component,
                    route: route,
                    bytes: currentBytes
                )
                connections[value.id] = Connection(
                    app: app,
                    bundleComponent: component,
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
    func readySnapshot() async -> TonoAppRoutingResearchUploadLease? {
        await withCheckedContinuation { continuation in
            queue.async { [self] in
                guard collectionActive, Self.isEnabled,
                      stored.ownerHash == activeOwnerHash else {
                    continuation.resume(returning: nil)
                    return
                }
                let timestamp = Int(Date().timeIntervalSince1970)
                discardExpiredPending(now: timestamp)
                sealElapsedWindowIfNeeded(now: timestamp)
                // Self-healing: never lease a payload the control plane cannot
                // accept. Holding one would occupy the single pending slot until
                // the ninety-day expiry and drop every window sealed in between.
                if let pending = stored.pending, !Self.fitsWireBudget(pending) {
                    stored.pending = nil
                    persistNow()
                }
                guard let snapshot = stored.pending,
                      let ownerHash = activeOwnerHash else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: TonoAppRoutingResearchUploadLease(
                    snapshot: snapshot,
                    ownerHash: ownerHash,
                    generation: activationGeneration
                ))
            }
        }
    }

    func isCurrent(_ lease: TonoAppRoutingResearchUploadLease) -> Bool {
        queue.sync {
            collectionActive && lease.generation == activationGeneration
                && lease.ownerHash == activeOwnerHash
                && lease.snapshot.snapshotId == stored.pending?.snapshotId
        }
    }

    func acknowledge(_ lease: TonoAppRoutingResearchUploadLease) {
        queue.async { [self] in
            guard collectionActive,
                  lease.generation == activationGeneration,
                  lease.ownerHash == activeOwnerHash,
                  stored.pending?.snapshotId == lease.snapshot.snapshotId else {
                return
            }
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
        stored.componentTotals.removeAll(keepingCapacity: true)
        stored.limitReached = false
        for connection in connections.values {
            addConnection(
                app: connection.app,
                bundleComponent: connection.bundleComponent,
                route: connection.route,
                bytes: 0
            )
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

    private func addConnection(
        app: String,
        bundleComponent: String?,
        route: String,
        bytes: Int64
    ) {
        guard Self.totalConnections(stored.totals) < Self.maximumCount else {
            stored.limitReached = true
            return
        }
        var total = stored.totals[app] ?? Total()
        Self.add(connectionWithRoute: route, bytes: bytes, to: &total)
        stored.totals[app] = total
        if let bundleComponent {
            let key = Self.componentKey(app: app, component: bundleComponent)
            var componentTotal = stored.componentTotals[key] ?? Total()
            Self.add(
                connectionWithRoute: route,
                bytes: bytes,
                to: &componentTotal
            )
            stored.componentTotals[key] = componentTotal
        }
    }

    private func addBytes(
        _ bytes: Int64,
        to app: String,
        bundleComponent: String? = nil
    ) {
        guard bytes > 0 else { return }
        var total = stored.totals[app] ?? Total()
        total.bytes = Self.boundedSum(total.bytes, bytes)
        stored.totals[app] = total
        if let bundleComponent {
            let key = Self.componentKey(app: app, component: bundleComponent)
            var componentTotal = stored.componentTotals[key] ?? Total()
            componentTotal.bytes = Self.boundedSum(componentTotal.bytes, bytes)
            stored.componentTotals[key] = componentTotal
        }
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

        let populatedRecognized = stored.totals.compactMap {
            app, total -> (app: String, total: Total)? in
            guard app != "other", total.connections > 0 else { return nil }
            return (app, total)
        }.sorted {
            if $0.total.connections != $1.total.connections {
                return $0.total.connections > $1.total.connections
            }
            if $0.total.bytes != $1.total.bytes {
                return $0.total.bytes > $1.total.bytes
            }
            return $0.app < $1.app
        }
        var otherTotal = stored.totals["other"] ?? Total()
        let initialRecognizedCapacity = Self.maximumSnapshotEntries
            - (otherTotal.connections > 0 ? 1 : 0)
        let recognizedCapacity: Int
        if populatedRecognized.count > initialRecognizedCapacity {
            // Reserve one entry for the omitted aggregates so all connections
            // remain represented without revealing another app identity.
            recognizedCapacity = Self.maximumSnapshotEntries - 1
        } else {
            recognizedCapacity = initialRecognizedCapacity
        }
        let selectedRecognized = populatedRecognized.prefix(recognizedCapacity)
        for omitted in populatedRecognized.dropFirst(recognizedCapacity) {
            Self.merge(omitted.total, into: &otherTotal)
        }
        var snapshotTotals = Dictionary(uniqueKeysWithValues:
            selectedRecognized.map { ($0.app, $0.total) }
        )
        if otherTotal.connections > 0 {
            snapshotTotals["other"] = otherTotal
        }

        let entries = snapshotTotals.compactMap {
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
        let selectedApps = Set(snapshotTotals.keys)
        let populatedComponents = stored.componentTotals.compactMap {
            key, total -> (identity: (app: String, component: String),
                           total: Total)? in
            guard total.connections > 0,
                  let identity = Self.componentIdentity(key),
                  selectedApps.contains(identity.app) else { return nil }
            return (identity, total)
        }.sorted {
            if $0.total.connections != $1.total.connections {
                return $0.total.connections > $1.total.connections
            }
            if $0.total.bytes != $1.total.bytes {
                return $0.total.bytes > $1.total.bytes
            }
            return ($0.identity.app, $0.identity.component)
                < ($1.identity.app, $1.identity.component)
        }
        let componentEntries = populatedComponents
            .prefix(Self.maximumSnapshotComponentEntries).map {
                value -> TonoAppRoutingResearchComponentEntry in
            return TonoAppRoutingResearchComponentEntry(
                app: value.identity.app,
                bundleComponent: value.identity.component,
                connectionCount: value.total.connections,
                directConnectionCount: value.total.direct,
                proxiedConnectionCount: value.total.proxied,
                blockedConnectionCount: value.total.blocked,
                trafficVolume: Self.bucket(value.total.bytes)
            )
        }.sorted {
            ($0.app, $0.bundleComponent) < ($1.app, $1.bundleComponent)
        }
        let version = ProcessInfo.processInfo.operatingSystemVersion
        #if arch(arm64)
        let architecture = "arm64"
        #elseif arch(x86_64)
        let architecture = "x86_64"
        #else
        return nil
        #endif
        return TonoAppRoutingResearchSnapshot(
            schemaVersion: 2,
            snapshotId: UUID().uuidString.lowercased(),
            observedSince: stored.observedSince,
            observedUntil: until,
            appVersion: appVersion,
            build: build,
            osVersion: "\(version.majorVersion).\(version.minorVersion)",
            architecture: architecture,
            observedConnectionCount: observed,
            identifiedAppConnectionCount: identified,
            connectionLimitReached: stored.limitReached
                || populatedRecognized.count > recognizedCapacity
                || populatedComponents.count
                    > Self.maximumSnapshotComponentEntries,
            entries: entries,
            bundleComponents: componentEntries
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
        guard Self.isEnabled, stored.ownerHash != nil else { return }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(stored),
              data.count <= Self.maximumStoredBytes else {
            return
        }
        try? ConfigStorage.shared.writeSensitive(data, to: fileURL)
    }

    private func reset(now timestamp: Int, ownerHash: String?) {
        persistenceWorkItem?.cancel()
        persistenceWorkItem = nil
        connections.removeAll(keepingCapacity: true)
        connectionOrder.removeAll(keepingCapacity: true)
        needsConnectionBaseline = true
        stored = Stored(
            ownerHash: ownerHash,
            observedSince: timestamp,
            totals: [:],
            componentTotals: [:],
            limitReached: false,
            pending: nil
        )
    }

    private func invalidateActivation() {
        activationGeneration &+= 1
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

    private static func add(
        connectionWithRoute route: String,
        bytes: Int64,
        to total: inout Total
    ) {
        total.connections += 1
        switch route {
        case "direct": total.direct += 1
        case "blocked": total.blocked += 1
        default: total.proxied += 1
        }
        total.bytes = boundedSum(total.bytes, bytes)
    }

    private static func merge(_ source: Total, into destination: inout Total) {
        destination.connections = min(
            destination.connections + source.connections,
            maximumCount
        )
        destination.direct = min(destination.direct + source.direct, maximumCount)
        destination.proxied = min(
            destination.proxied + source.proxied,
            maximumCount
        )
        destination.blocked = min(
            destination.blocked + source.blocked,
            maximumCount
        )
        destination.bytes = boundedSum(destination.bytes, source.bytes)
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

    private static func ownerHash(_ userID: String) -> String {
        SHA256.hash(data: Data(userID.utf8)).map {
            String(format: "%02x", $0)
        }.joined()
    }

    private static func componentKey(app: String, component: String) -> String {
        "\(app):\(component)"
    }

    private static func componentIdentity(
        _ key: String
    ) -> (app: String, component: String)? {
        let values = key.split(separator: ":", omittingEmptySubsequences: false)
        guard values.count == 2 else { return nil }
        let app = String(values[0])
        let component = String(values[1])
        guard componentFamilies.contains(app),
              bundleComponents.contains(component) else { return nil }
        return (app, component)
    }

    private static func bundleComponent(
        for app: String,
        processPath: String?
    ) -> String? {
        AppRoutingResearchClassifier.bundleComponent(
            for: app,
            processPath: processPath
        )
    }

    private static func family(process: String?, path: String?) -> String {
        AppRoutingResearchClassifier.family(process: process, path: path)
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
              Set(value.totals.keys).isSubset(of: families),
               value.componentTotals.count
                 <= componentFamilies.count * bundleComponents.count,
               value.componentTotals.keys.allSatisfy({
                   componentIdentity($0) != nil
               }),
               value.ownerHash == nil || value.ownerHash?.range(
                   of: #"^[0-9a-f]{64}$"#,
                   options: .regularExpression
               ) != nil else { return false }
        var allConnections = 0
        for total in value.totals.values {
            guard total.connections >= 0, total.connections <= maximumCount,
                  total.direct >= 0, total.direct <= maximumCount,
                  total.proxied >= 0, total.proxied <= maximumCount,
                  total.blocked >= 0, total.blocked <= maximumCount,
                  total.direct + total.proxied + total.blocked == total.connections,
                  total.bytes >= 0, total.bytes <= maximumBytes else { return false }
            allConnections += total.connections
            guard allConnections <= maximumCount else { return false }
        }
        var componentConnections: [String: Int] = [:]
        for (key, total) in value.componentTotals {
            guard let identity = componentIdentity(key),
                  let appTotal = value.totals[identity.app],
                  total.connections >= 0, total.connections <= maximumCount,
                  total.direct >= 0, total.direct <= maximumCount,
                  total.proxied >= 0, total.proxied <= maximumCount,
                  total.blocked >= 0, total.blocked <= maximumCount,
                  total.direct + total.proxied + total.blocked
                    == total.connections,
                  total.bytes >= 0, total.bytes <= maximumBytes,
                  total.connections <= appTotal.connections,
                  total.direct <= appTotal.direct,
                  total.proxied <= appTotal.proxied,
                  total.blocked <= appTotal.blocked,
                  total.bytes <= appTotal.bytes else { return false }
            componentConnections[identity.app, default: 0] += total.connections
            guard componentConnections[identity.app, default: 0]
                    <= appTotal.connections else { return false }
        }
        guard let pending = value.pending else { return true }
        return isValid(pending, now: timestamp)
    }

    private static func isValid(
        _ snapshot: TonoAppRoutingResearchSnapshot,
        now timestamp: Int
    ) -> Bool {
        guard [1, 2].contains(snapshot.schemaVersion),
              UUID(uuidString: snapshot.snapshotId) != nil,
              snapshot.observedSince >= 0,
              snapshot.observedUntil >= snapshot.observedSince,
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
              snapshot.entries.count <= maximumSnapshotEntries else { return false }
        var apps = Set<String>()
        var observed = 0
        var identified = 0
        for entry in snapshot.entries {
            guard families.contains(entry.app), apps.insert(entry.app).inserted,
                  trafficVolumes.contains(entry.trafficVolume),
                  entry.connectionCount >= 1,
                  entry.connectionCount <= maximumCount,
                  entry.directConnectionCount >= 0,
                  entry.directConnectionCount <= maximumCount,
                  entry.proxiedConnectionCount >= 0,
                  entry.proxiedConnectionCount <= maximumCount,
                  entry.blockedConnectionCount >= 0,
                  entry.blockedConnectionCount <= maximumCount,
                  entry.directConnectionCount + entry.proxiedConnectionCount
                    + entry.blockedConnectionCount == entry.connectionCount else {
                return false
            }
            observed += entry.connectionCount
            if entry.app != "other" { identified += entry.connectionCount }
            guard observed <= maximumCount else { return false }
        }
        guard observed == snapshot.observedConnectionCount,
              identified == snapshot.identifiedAppConnectionCount else {
            return false
        }
        if snapshot.schemaVersion == 1 {
            return snapshot.bundleComponents == nil && fitsWireBudget(snapshot)
        }
        guard let components = snapshot.bundleComponents,
              components.count <= maximumAcceptedComponentEntries else {
            return false
        }
        let appTotals = Dictionary(uniqueKeysWithValues: snapshot.entries.map {
            ($0.app, $0)
        })
        var identities = Set<String>()
        var componentAppTotals: [String: (connections: Int, direct: Int,
                                         proxied: Int, blocked: Int)] = [:]
        for component in components {
            let identity = componentKey(
                app: component.app,
                component: component.bundleComponent
            )
            guard componentFamilies.contains(component.app),
                  bundleComponents.contains(component.bundleComponent),
                  identities.insert(identity).inserted,
                  trafficVolumes.contains(component.trafficVolume),
                  component.connectionCount >= 1,
                  component.connectionCount <= maximumCount,
                  component.directConnectionCount >= 0,
                  component.directConnectionCount <= maximumCount,
                  component.proxiedConnectionCount >= 0,
                  component.proxiedConnectionCount <= maximumCount,
                  component.blockedConnectionCount >= 0,
                  component.blockedConnectionCount <= maximumCount,
                  component.directConnectionCount
                    + component.proxiedConnectionCount
                    + component.blockedConnectionCount
                    == component.connectionCount,
                  let appTotal = appTotals[component.app],
                  trafficVolumeRank(component.trafficVolume)
                    <= trafficVolumeRank(appTotal.trafficVolume) else {
                return false
            }
            var total = componentAppTotals[component.app]
                ?? (0, 0, 0, 0)
            total.connections += component.connectionCount
            total.direct += component.directConnectionCount
            total.proxied += component.proxiedConnectionCount
            total.blocked += component.blockedConnectionCount
            guard total.connections <= appTotal.connectionCount,
                  total.direct <= appTotal.directConnectionCount,
                  total.proxied <= appTotal.proxiedConnectionCount,
                  total.blocked <= appTotal.blockedConnectionCount else {
                return false
            }
            componentAppTotals[component.app] = total
        }
        return fitsWireBudget(snapshot)
    }

    /// Measured on the encoded form rather than derived from the entry caps, so a
    /// later field addition or a legacy payload cannot reintroduce a snapshot the
    /// control plane is unable to accept. `JSONEncoder` emits the same keys and
    /// values the worker canonicalizes, so the byte counts agree.
    private static func fitsWireBudget(
        _ snapshot: TonoAppRoutingResearchSnapshot
    ) -> Bool {
        guard let data = try? JSONEncoder().encode(snapshot) else { return false }
        return data.count <= maximumSnapshotWireBytes
    }

    private static func trafficVolumeRank(_ value: String) -> Int {
        switch value {
        case "none": 0
        case "under_1_mib": 1
        case "1_to_10_mib": 2
        case "10_to_100_mib": 3
        case "100_mib_to_1_gib": 4
        case "1_to_10_gib": 5
        case "over_10_gib": 6
        default: Int.max
        }
    }
}
