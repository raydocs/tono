import Foundation
import Darwin

nonisolated struct TrafficAuditProtectionSnapshot: Sendable {
    let connected: Bool
    let connecting: Bool
    let protectionBlocked: Bool
    let killSwitchArmed: Bool
    let tunPresent: Bool
    let protectedDNSConfigured: Bool
    let selectedExit: String
}

nonisolated struct ResidentialRouteAuditContext: Equatable, Sendable {
    let generation: UInt64
    let runtimeConfigDigest: String
    let admittedTerminal: String?

    var contractRequired: Bool { admittedTerminal != nil }
}

nonisolated struct CoreAuditEntry: Sendable {
    let level: String
    let message: String
}

nonisolated struct ClaudeTrafficResearchKey: Hashable, Sendable {
    let service: String
    let client: String
    let host: String
    let network: String
    let port: Int
    let route: String
}

nonisolated struct ClaudeTrafficResearchTotal: Sendable {
    var connections: Int
    var upBytes: Int64
    var downBytes: Int64
}

nonisolated struct ClaudeTrafficResearchConnection: Sendable {
    let key: ClaudeTrafficResearchKey
    var upBytes: Int64
    var downBytes: Int64
}

nonisolated struct AuditRedaction: @unchecked Sendable {
    let expression: NSRegularExpression
    let replacement: String
}

/// A local-only, bounded JSONL audit trail for diagnosing routing and DNS
/// failures. It records connection metadata and Mihomo routing messages, but it
/// never observes TLS bodies, prompts, Authorization headers, cookies, or
/// account tokens. Files are mode 0600 and rotate before reaching 10 MiB.
nonisolated final class LocalTrafficAudit: @unchecked Sendable {
    static let shared = LocalTrafficAudit()
    static let maximumFileBytes = 10 * 1_024 * 1_024
    static let maximumBackups = 2

    static var isEnabled: Bool {
        AppProfile.defaults.object(
            forKey: SettingsKey.localTrafficAuditEnabled
        ) as? Bool ?? true
    }

    static var isClaudeTrafficResearchEnabled: Bool {
        AppProfile.defaults.bool(
            forKey: SettingsKey.claudeTrafficResearchEnabled
        )
    }

    let logFileURL: URL

    let fileManager = FileManager.default
    /// One report per group per process: the point is to learn that it happened
    /// at all, not to add a line to every connection while it stays failed over.
    var reportedManagedDirectFallbacks: Set<String> = []
    let queue = DispatchQueue(
        label: "com.raydocs.tono.local-traffic-audit",
        qos: .utility
    )
    let sessionID = UUID().uuidString
    let timestampFormatter: ISO8601DateFormatter
    var pending: [Data] = []
    var pendingBytes = 0
    var flushWorkItem: DispatchWorkItem?
    var seenConnectionIDs = Set<String>()
    var seenConnectionOrder: [String] = []
    var researchObservedSince = Int(Date().timeIntervalSince1970)
    var researchTotals: [
        ClaudeTrafficResearchKey: ClaudeTrafficResearchTotal
    ] = [:]
    var researchConnections: [
        String: ClaudeTrafficResearchConnection
    ] = [:]
    /// Insertion order for `researchConnections`, so the oldest byte cursors can
    /// be evicted instead of freezing every counter at the cap.
    var researchConnectionOrder: [String] = []
    var researchSeenConnectionIDs = Set<String>()
    var researchSeenConnectionOrder: [String] = []
    var researchDroppedKeys = Set<ClaudeTrafficResearchKey>()
    var researchObservedConnectionCount = 0
    var researchIdentifiedProcessConnectionCount = 0
    var researchResidentialConnectionCount = 0
    var researchProxiedConnectionCount = 0
    var researchDirectConnectionCount = 0
    var researchBlockedConnectionCount = 0
    var researchDirectRouteAttemptCount = 0
    var researchManagedDirectRouteCount = 0
    var researchUnclassifiedRouteCount = 0
    var researchUnsafeProtectionObservationCount = 0
    var researchWebManagedDirectConnectionCount = 0
    var researchWeChatConnectionCount = 0
    var researchWeChatManagedDirectConnectionCount = 0
    var researchWeChatProxiedConnectionCount = 0
    var researchWeChatBlockedConnectionCount = 0
    var researchWeChatEndpointUnknownProcessConnectionCount = 0
    var researchUnknownManagedDirectConnectionCount = 0
    var researchOtherManagedDirectConnectionCount = 0
    var researchProtectedDirectConnectionCount = 0
    var researchConnectionLimitReached = false
    var residentialRouteContext: ResidentialRouteAuditContext?
    var researchProtection = TrafficAuditProtectionSnapshot(
        connected: false,
        connecting: false,
        protectionBlocked: false,
        killSwitchArmed: false,
        tunPresent: false,
        protectedDNSConfigured: false,
        selectedExit: "unknown"
    )
    static let maximumResearchEndpointKeys = 64
    static let maximumResearchConnections = 20_000
    static let maximumResearchCount = 1_000_000
    static let maximumResearchBytes: Int64 = 1_000_000_000_000_000
    static let redactions: [AuditRedaction] = [
        (
            #"(?i)(authorization|proxy-authorization|cookie|set-cookie)\s*[:=].*$"#,
            "$1=<redacted>"
        ),
        (#"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+"#, "$1 <redacted>"),
        (
            #"(?i)(access[_-]?token|refresh[_-]?token|password|secret|api[_-]?key|auth[_-]?key)=([^&\s]+)"#,
            "$1=<redacted>"
        ),
        (#"(?i)\b(sk-ant-[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{16,})\b"#, "<redacted>"),
        (#"(?i)(https?://)[^/@\s]+@"#, "$1<redacted>@"),
        (#"(https?://[^\s?#]+)\?[^\s]+"#, "$1?<redacted>"),
    ].compactMap { pattern, replacement in
        guard let expression = try? NSRegularExpression(pattern: pattern) else {
            return nil
        }
        return AuditRedaction(
            expression: expression,
            replacement: replacement
        )
    }

    private init() {
        let directory = ConfigStorage.shared.appSupportDirectory
            .appendingPathComponent("Logs", isDirectory: true)
        try? fileManager.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        try? fileManager.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory.path
        )
        logFileURL = directory.appendingPathComponent("traffic-audit.jsonl")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        timestampFormatter = formatter
    }

    func setEnabled(_ enabled: Bool) {
        AppProfile.defaults.set(
            enabled,
            forKey: SettingsKey.localTrafficAuditEnabled
        )
        queue.async { [self] in
            enqueue(
                kind: enabled ? "audit_enabled" : "audit_disabled",
                fields: [:],
                force: true
            )
            if !enabled {
                flushPending()
            }
        }
    }

    func setClaudeTrafficResearchEnabled(_ enabled: Bool) {
        AppProfile.defaults.set(
            enabled,
            forKey: SettingsKey.claudeTrafficResearchEnabled
        )
        queue.async { [self] in
            researchObservedSince = Int(Date().timeIntervalSince1970)
            researchTotals.removeAll(keepingCapacity: true)
            researchConnections.removeAll(keepingCapacity: true)
            researchConnectionOrder.removeAll(keepingCapacity: true)
            researchSeenConnectionIDs.removeAll(keepingCapacity: true)
            researchSeenConnectionOrder.removeAll(keepingCapacity: true)
            researchDroppedKeys.removeAll(keepingCapacity: true)
            researchObservedConnectionCount = 0
            researchIdentifiedProcessConnectionCount = 0
            researchResidentialConnectionCount = 0
            researchProxiedConnectionCount = 0
            researchDirectConnectionCount = 0
            researchBlockedConnectionCount = 0
            researchDirectRouteAttemptCount = 0
            researchManagedDirectRouteCount = 0
            researchUnclassifiedRouteCount = 0
            researchUnsafeProtectionObservationCount = 0
            researchWebManagedDirectConnectionCount = 0
            researchWeChatConnectionCount = 0
            researchWeChatManagedDirectConnectionCount = 0
            researchWeChatProxiedConnectionCount = 0
            researchWeChatBlockedConnectionCount = 0
            researchWeChatEndpointUnknownProcessConnectionCount = 0
            researchUnknownManagedDirectConnectionCount = 0
            researchOtherManagedDirectConnectionCount = 0
            researchProtectedDirectConnectionCount = 0
            researchConnectionLimitReached = false
            researchProtection = TrafficAuditProtectionSnapshot(
                connected: false,
                connecting: false,
                protectionBlocked: false,
                killSwitchArmed: false,
                tunPresent: false,
                protectedDNSConfigured: false,
                selectedExit: "unknown"
            )
        }
    }

    func claudeTrafficResearchSnapshot(
        exitIdentityConsistency: String = "INCONCLUSIVE",
        physicalBypassProbe: String = "INCONCLUSIVE"
    )
        -> TonoClaudeTrafficResearchSnapshot {
        queue.sync { [self] in
            let entries = researchTotals.map { key, total in
                TonoClaudeTrafficResearchEntry(
                    service: key.service,
                    client: key.client,
                    host: key.host,
                    network: key.network,
                    port: key.port,
                    route: key.route,
                    connections: total.connections,
                    upBytes: total.upBytes,
                    downBytes: total.downBytes
                )
            }.sorted {
                let leftBytes = $0.upBytes + $0.downBytes
                let rightBytes = $1.upBytes + $1.downBytes
                if leftBytes != rightBytes { return leftBytes > rightBytes }
                if $0.connections != $1.connections {
                    return $0.connections > $1.connections
                }
                if $0.host != $1.host { return $0.host < $1.host }
                if $0.client != $1.client { return $0.client < $1.client }
                if $0.network != $1.network { return $0.network < $1.network }
                return $0.port < $1.port
            }
            // Two worst-case 100-byte hosts plus the WeChat trial aggregates
            // remain below the Worker's strict 2 KiB result limit.
            let visibleEntries = Array(entries.prefix(2))
            let omittedEntries = max(0, entries.count - visibleEntries.count)
            return TonoClaudeTrafficResearchSnapshot(
                observedSince: researchObservedSince,
                droppedEndpointCount: min(
                    researchDroppedKeys.count + omittedEntries,
                    Self.maximumResearchEndpointKeys
                ),
                observedConnectionCount: researchObservedConnectionCount,
                identifiedProcessConnectionCount:
                    researchIdentifiedProcessConnectionCount,
                proxiedConnectionCount: researchProxiedConnectionCount,
                residentialConnectionCount: researchResidentialConnectionCount,
                directConnectionCount: researchDirectConnectionCount,
                blockedConnectionCount: researchBlockedConnectionCount,
                directRouteAttemptCount: researchDirectRouteAttemptCount,
                managedDirectRouteCount: researchManagedDirectRouteCount,
                unclassifiedRouteCount: researchUnclassifiedRouteCount,
                unsafeProtectionObservationCount:
                    researchUnsafeProtectionObservationCount,
                webManagedDirectConnectionCount:
                    researchWebManagedDirectConnectionCount,
                weChatConnectionCount: researchWeChatConnectionCount,
                weChatManagedDirectConnectionCount:
                    researchWeChatManagedDirectConnectionCount,
                weChatProxiedConnectionCount:
                    researchWeChatProxiedConnectionCount,
                weChatBlockedConnectionCount:
                    researchWeChatBlockedConnectionCount,
                weChatEndpointUnknownProcessConnectionCount:
                    researchWeChatEndpointUnknownProcessConnectionCount,
                unknownManagedDirectConnectionCount:
                    researchUnknownManagedDirectConnectionCount,
                otherManagedDirectConnectionCount:
                    researchOtherManagedDirectConnectionCount,
                protectedDirectConnectionCount:
                    researchProtectedDirectConnectionCount,
                connectionLimitReached: researchConnectionLimitReached,
                connected: researchProtection.connected,
                killSwitchArmed: researchProtection.killSwitchArmed,
                tunPresent: researchProtection.tunPresent,
                protectedDNSConfigured:
                    researchProtection.protectedDNSConfigured,
                exitIdentityConsistency: exitIdentityConsistency,
                physicalBypassProbe: physicalBypassProbe,
                entries: visibleEntries
            )
        }
    }

    func recordEvent(_ event: String, details: [String: String] = [:]) {
        guard Self.isEnabled else { return }
        queue.async { [self] in
            var fields = details
            fields["event"] = event
            enqueue(kind: "protection_event", fields: fields)
        }
    }

    static let unclassifiedRoute = "UNCLASSIFIED"

    /// Groups whose whole purpose is "this member first, the exit only if it is
    /// unreachable", with the member each one is supposed to be sitting on.
    ///
    /// The China groups are fixed. The assistant group is not: it exists only
    /// when the catalog carries a residential hop, and its first member is that
    /// hop, so it is registered at the same moment the runtime commits to one.
    static let staticDirectFirstGroupMembers = [
        ConfigPipeline.appDirectGroupName: ConfigPipeline.directProxyName,
        ConfigPipeline.webDirectGroupName: ConfigPipeline.webDirectProxyName,
    ]

    /// Set when a runtime is built with a residential hop, cleared when one is
    /// built without. Nothing is reported for the assistant group while this is
    /// nil, because without a hop the group either does not exist or its first
    /// member is a catalog node whose name is not knowable here.
    nonisolated(unsafe) private static var assistantDirectFirstMember: String?
    static let assistantMemberLock = NSLock()

    /// Registers the member `Tono-Claude-Home` is expected to be sitting on.
    ///
    /// Worth its own entry point rather than a constant: this is the one
    /// failover in the product that silently changes *who the user appears to
    /// be*. Claude and ChatGPT are routed through a residential hop precisely
    /// so their egress identity is a home connection; when that hop's health
    /// check misses, the group quietly moves them onto the datacenter exit and
    /// every downstream signal still reads "PROXIED". The China groups only
    /// change how fast traffic is.
    static func setAssistantDirectFirstMember(_ name: String?) {
        assistantMemberLock.lock()
        defer { assistantMemberLock.unlock() }
        assistantDirectFirstMember = name
    }

    private static func directFirstMember(for group: String) -> String? {
        if let known = staticDirectFirstGroupMembers[group] { return known }
        guard group == ConfigPipeline.claudeHomeGroupName else { return nil }
        assistantMemberLock.lock()
        defer { assistantMemberLock.unlock() }
        return assistantDirectFirstMember
    }

    /// The direct-first group in this route decision that is no longer on its
    /// direct member, if any.
    ///
    /// Mihomo writes the selection as `using <group>[<proxy>]` where the
    /// bracket holds the *leaf* proxy, not the intermediate group — a failed
    /// over `Tono-China-App` reads `Tono-China-App[US-VLESS-Reality]`, never
    /// `[Tono-Exit]`. So the test is "not the member it should be on", which
    /// needs no knowledge of which exit node happens to be selected.
    static func managedDirectGroupThatFellBack(_ message: String) -> String? {
        guard let using = message.range(of: " using ", options: .backwards),
              message[message.startIndex..<using.lowerBound].contains(" match ")
        else {
            return nil
        }
        let outbound = message[using.upperBound...]
        guard let open = outbound.firstIndex(of: "["),
              let close = outbound.lastIndex(of: "]"), open < close else {
            return nil
        }
        let group = String(outbound[outbound.startIndex..<open])
        guard let expected = directFirstMember(for: group) else { return nil }
        let selected = String(outbound[outbound.index(after: open)..<close])
        return selected == expected ? nil : group
    }

    /// Classify one Mihomo log line's routing decision.
    ///
    /// Extracted so the vocabulary can be tested without a running core. Two
    /// buckets exist because both were being answered with "UNCLASSIFIED", and
    /// that made the one number meant to surface routes Tono does not
    /// understand into noise — 13 670 `REJECT` decisions and 2 339 lines that
    /// were never routing decisions at all, against 62 genuine unknowns, in
    /// four days of one Mac's log:
    ///
    /// - `BLOCKED`: a `REJECT` outbound. Deliberate and high-volume — the
    ///   terminal `AND,((NETWORK,UDP)),REJECT` rule rejects every UDP flow the
    ///   direct routes do not claim — and it is the same word
    ///   `classifyConnection` already uses.
    /// - `NOT_A_ROUTE`: this is every core log line, not only route decisions.
    ///   A line with no ` using ` clause did not route anything, and calling
    ///   that an unrecognised route is simply false.
    static func classifyCoreRouteLog(_ message: String) -> String {
        // A routing decision is `… match <rule> using <group>[<proxy>]`. Both
        // halves are required: Mihomo also logs prose containing the word
        // "using" ("… using fake ping echo"), and reading an outbound name out
        // of that is how chatter became an unrecognised route.
        guard let using = message.range(of: " using ", options: .backwards),
              message[message.startIndex..<using.lowerBound].contains(" match ")
        else {
            return "NOT_A_ROUTE"
        }
        let outbound = message[using.upperBound...]
        func selects(_ name: String) -> Bool {
            outbound.hasPrefix(name)
        }
        if selects("REJECT") {
            return "BLOCKED"
        }
        if selects(ConfigPipeline.directProxyName)
            || selects(ConfigPipeline.webDirectProxyName)
            || selects(ConfigPipeline.appDirectGroupName)
            || selects(ConfigPipeline.webDirectGroupName)
            || selects(ConfigPipeline.managedDirectFallbackGroupPrefix) {
            return "MANAGED_DIRECT"
        }
        if selects("DIRECT") {
            // A Mihomo route decision is not proof that PF put the packet on
            // the wire, but it must remain conspicuous in an exported audit
            // instead of being hidden from connection snapshots that do not
            // include ICMP.
            return "DIRECT_ATTEMPT"
        }
        if selects(ConfigPipeline.claudeHomeGroupName)
            || selects(ConfigPipeline.homeResidentialProxyName)
            || selects(ConfigPipeline.exitGroupName) {
            return "PROXIED"
        }
        return unclassifiedRoute
    }

    func recordCoreLogs(_ entries: [(level: String, message: String)]) {
        let localAuditEnabled = Self.isEnabled
        let researchEnabled = Self.isClaudeTrafficResearchEnabled
        guard (localAuditEnabled || researchEnabled), !entries.isEmpty else {
            return
        }
        let values = entries.map {
            CoreAuditEntry(level: $0.level, message: $0.message)
        }
        queue.async { [self] in
            for entry in values {
                let routeClassification = Self.classifyCoreRouteLog(entry.message)
                if researchEnabled && Self.isClaudeTrafficResearchEnabled {
                    switch routeClassification {
                    case "DIRECT_ATTEMPT":
                        researchDirectRouteAttemptCount = min(
                            researchDirectRouteAttemptCount + 1,
                            Self.maximumResearchCount
                        )
                    case "MANAGED_DIRECT":
                        researchManagedDirectRouteCount = min(
                            researchManagedDirectRouteCount + 1,
                            Self.maximumResearchCount
                        )
                    case Self.unclassifiedRoute:
                        // Only real route decisions. `NOT_A_ROUTE` used to land
                        // here too, and this counter exists to say "Tono saw a
                        // route it does not understand" — a number that was 85%
                        // Mihomo chatter answered nothing.
                        researchUnclassifiedRouteCount = min(
                            researchUnclassifiedRouteCount + 1,
                            Self.maximumResearchCount
                        )
                    default:
                        break
                    }
                }
                guard localAuditEnabled, Self.isEnabled else { continue }
                // A direct-first group that has selected the exit is the one
                // transition worth naming. It means an entire app quietly moved
                // to the cloud exit because one health probe missed, and it is
                // invisible in a route log that says only "PROXIED" — the same
                // word an ordinary MATCH produces. It has not been observed in
                // any retained log, which is exactly why it needs to announce
                // itself the first time it does rather than be reconstructed
                // afterwards from chains.
                if let group = Self.managedDirectGroupThatFellBack(entry.message),
                   !reportedManagedDirectFallbacks.contains(group) {
                    reportedManagedDirectFallbacks.insert(group)
                    enqueue(
                        kind: "protection_event",
                        fields: [
                            "event": "managed_direct_group_failed_over",
                            "group": group,
                            "route": String(entry.message.suffix(160)),
                        ]
                    )
                }
                let network = entry.message.first == "["
                    ? entry.message.dropFirst().prefix { $0 != "]" }.uppercased()
                    : "UNKNOWN"
                enqueue(
                    kind: "mihomo_route",
                    fields: [
                        "level": entry.level,
                        "message": entry.message,
                        "network": network,
                        "route_classification": routeClassification,
                    ]
                )
            }
        }
    }

    func recordConnections(
        _ connections: [APIConnection],
        protection: TrafficAuditProtectionSnapshot,
        residentialContext: ResidentialRouteAuditContext?
    ) {
        let localAuditEnabled = Self.isEnabled
        let researchEnabled = Self.isClaudeTrafficResearchEnabled
        let appResearchEnabled = AppRoutingResearch.isCollectionActive
        guard localAuditEnabled || researchEnabled || appResearchEnabled else { return }
        queue.async { [self] in
            guard residentialContext == residentialRouteContext else { return }
            if appResearchEnabled && AppRoutingResearch.isCollectionActive {
                AppRoutingResearch.shared.record(connections)
            }
            if researchEnabled && Self.isClaudeTrafficResearchEnabled {
                recordResearchProtection(protection)
            }
            for connection in connections {
                if researchEnabled && Self.isClaudeTrafficResearchEnabled {
                    recordResearchConnectionObservation(
                        connection,
                        residentialContext: residentialContext
                    )
                    recordClaudeTrafficResearch(
                        connection,
                        residentialContext: residentialContext
                    )
                }
                guard localAuditEnabled, Self.isEnabled else { continue }
                guard seenConnectionIDs.insert(connection.id).inserted else {
                    continue
                }
                seenConnectionOrder.append(connection.id)
                if seenConnectionOrder.count > 20_000 {
                    let expired = Array(seenConnectionOrder.prefix(2_000))
                    seenConnectionOrder.removeFirst(expired.count)
                    seenConnectionIDs.subtract(expired)
                }

                let metadata = connection.metadata
                let host = metadata.host.isEmpty
                    ? metadata.destinationIP ?? "unknown"
                    : metadata.host
                let processPath = Self.displayProcessPath(metadata.processPath)
                let process: String = {
                    let named = Self.displayProcessField(metadata.process)
                    if named != "unknown" { return named }
                    if processPath == "unknown" { return "unknown" }
                    let base = URL(fileURLWithPath: processPath).lastPathComponent
                    return Self.displayProcessField(base)
                }()
                let chain = connection.chains.isEmpty
                    ? "Direct"
                    : connection.chains.joined(separator: " -> ")
                let lowerHost = host.lowercased().trimmingCharacters(
                    in: CharacterSet(charactersIn: ".")
                )
                let lowerProcessIdentity = "\(process) \(processPath)".lowercased()
                let isClaudeHost = lowerHost == "claude.ai"
                    || lowerHost.hasSuffix(".claude.ai")
                let isAnthropicHost = lowerHost == "anthropic.com"
                    || lowerHost.hasSuffix(".anthropic.com")
                let client: String
                if isClaudeHost || lowerProcessIdentity.contains("claude") {
                    client = "claude-related"
                } else if isAnthropicHost
                    || lowerProcessIdentity.contains("anthropic") {
                    client = "anthropic-related"
                } else if lowerHost.contains("claude")
                    || lowerHost.contains("anthropic") {
                    // Preserve discovery of third-party lookalike domains
                    // without claiming they are official Claude traffic.
                    client = "name-match-only"
                } else {
                    client = "other"
                }
                let routeClassification = Self.routeClassification(
                    connection,
                    residentialContext: residentialContext
                )

                enqueue(
                    kind: "connection_opened",
                    fields: [
                        "connection_id": connection.id,
                        "client": client,
                        "process": process,
                        "process_path": processPath,
                        "network": metadata.network.uppercased(),
                        "socket_type": metadata.type,
                        "source_ip": metadata.sourceIP ?? "unknown",
                        "source_port": metadata.sourcePort ?? "unknown",
                        "host": host,
                        "destination_ip": metadata.destinationIP ?? "unknown",
                        "destination_port": metadata.destinationPort ?? "unknown",
                        "route": chain,
                        "route_classification": routeClassification,
                        "rule": connection.rule,
                        "rule_payload": connection.rulePayload ?? "",
                        "started_at": connection.start,
                        "selected_exit": protection.selectedExit,
                        "connected": String(protection.connected),
                        "connecting": String(protection.connecting),
                        "protection_blocked": String(protection.protectionBlocked),
                        "kill_switch_armed": String(protection.killSwitchArmed),
                        "tun_present": String(protection.tunPresent),
                        "protected_dns_configured": String(
                            protection.protectedDNSConfigured
                        ),
                        "residential_contract_required": String(
                            residentialContext?.contractRequired == true
                        ),
                        "residential_terminal":
                            residentialContext?.admittedTerminal ?? "none",
                        "runtime_generation": residentialContext.map {
                            String($0.generation)
                        } ?? "none",
                        "runtime_config_digest":
                            residentialContext?.runtimeConfigDigest ?? "none",
                    ]
                )
            }
        }
    }

    /// Synchronously swaps generation evidence so already-enqueued callbacks
    /// from the old core cannot be attributed to the newly admitted runtime.
    func setResidentialRouteContext(_ context: ResidentialRouteAuditContext?) {
        queue.sync { residentialRouteContext = context }
    }
}
