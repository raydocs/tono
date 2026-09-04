import Foundation

// Wire models for the Tono v1 account API. Optional response fields deliberately
// tolerate additive server changes and partially populated suspended accounts.
nonisolated struct TonoUser: Codable, Identifiable, Sendable, Equatable {
    let id: String
    let email: String
    let name: String?
    let plan: String?
    let deviceLimit: Int?
    let quotaBytes: Int64?
    let usageBytes: Int64?
    let expiresAt: Date?
    let suspended: Bool?
}

nonisolated struct TonoDevice: Codable, Identifiable, Sendable, Equatable {
    let id: String
    let name: String
    let installationId: String?
    let createdAt: Date?
    let lastSeenAt: Date?
    let confirmedAt: Date?
    let current: Bool?
    let status: String?
    /// Tailscale Device API management id used for tag/delete (not status Self.ID).
    let tailscaleNodeId: String?
    /// Wire field is `stableNodeId` (status Self.ID), not the management id.
    let tailscaleStableId: String?
    let tailscaleApiNodeId: String?
    let tailscaleIPs: [String]?

    enum CodingKeys: String, CodingKey {
        case id, name, installationId, createdAt, lastSeenAt, confirmedAt, current, status
        case tailscaleNodeId
        case tailscaleStableId = "stableNodeId"
        case tailscaleApiNodeId, tailscaleIPs
    }
}

/// Local Tailscale identity collected from `tailscale status --json` for confirm.
nonisolated struct TonoNodeIdentity: Sendable, Equatable {
    /// status Self.ID — StableNodeID
    let stableNodeId: String
    /// Optional Device API nodeId if known (usually resolved server-side)
    let nodeId: String?
    /// status Self.PublicKey. Required because StableNodeID is a client-reported
    /// audit value; the Worker must bind confirm to a server-observed identity.
    let publicKey: String
    let tailscaleIPs: [String]
}

nonisolated struct TonoEnrollment: Codable, Sendable, Equatable {
    let id: String?
    let authKey: String?
    /// Server-issued unguessable label passed to `tailscale up --hostname`.
    /// The Worker requires the same label in inventory during confirm.
    let hostname: String?
    let expiresAt: Date?
    let state: String?
}

nonisolated struct TonoTokenResponse: Codable, Sendable {
    let accessToken: String
    let refreshToken: String
}

nonisolated struct TonoAuthResponse: Codable, Sendable {
    let accessToken: String
    let refreshToken: String?
    let user: TonoUser
    let device: TonoDevice?
    let enrollment: TonoEnrollment?
}

/// The worker may wrap authentication payloads as `{ auth: ... }`; accept both
/// that final envelope and the legacy unwrapped development response.
nonisolated struct TonoAuthEnvelope: Decodable, Sendable {
    let auth: TonoAuthResponse
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        auth = try container.decodeIfPresent(TonoAuthResponse.self, forKey: .auth)
            ?? TonoAuthResponse(from: decoder)
    }
    private enum CodingKeys: String, CodingKey { case auth }
}

nonisolated struct TonoMeResponse: Codable, Sendable { let user: TonoUser }
nonisolated struct TonoDevicesResponse: Codable, Sendable { let devices: [TonoDevice] }
nonisolated struct TonoEnrollmentResponse: Codable, Sendable { let enrollment: TonoEnrollment }
nonisolated struct TonoConfirmResponse: Codable, Sendable { let device: TonoDevice }
/// Optional control-plane route pins. Older servers omit this object and keep
/// the pre-routing behavior.
nonisolated struct TonoExitCatalogHomeSocks5: Codable, Sendable, Equatable {
    let host: String
    let port: Int
    let username: String
    let password: String

    init(
        host: String,
        port: Int,
        username: String,
        password: String
    ) {
        self.host = host
        self.port = port
        self.username = username
        self.password = password
    }

    /// Keep a malformed optional routing directive from rejecting the whole
    /// verified catalog. Validation happens again before runtime generation.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        host = (try? container.decode(String.self, forKey: .host)) ?? ""
        port = (try? container.decode(Int.self, forKey: .port)) ?? 0
        username = (try? container.decode(String.self, forKey: .username)) ?? ""
        password = (try? container.decode(String.self, forKey: .password)) ?? ""
    }

    private enum CodingKeys: String, CodingKey {
        case host, port, username, password
    }
}

nonisolated struct TonoExitCatalogRouting: Codable, Sendable, Equatable {
    let homeProxy: String?
    let defaultProxy: String?
    let homeSocks5: TonoExitCatalogHomeSocks5?

    init(
        homeProxy: String? = nil,
        defaultProxy: String? = nil,
        homeSocks5: TonoExitCatalogHomeSocks5? = nil
    ) {
        self.homeProxy = homeProxy
        self.defaultProxy = defaultProxy
        self.homeSocks5 = homeSocks5
    }

    /// Routing is additive server input. Ignore malformed individual fields
    /// while allowing revision/YAML integrity validation to continue.
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        homeProxy = try? container.decodeIfPresent(String.self, forKey: .homeProxy)
        defaultProxy = try? container.decodeIfPresent(String.self, forKey: .defaultProxy)
        homeSocks5 = try? container.decodeIfPresent(
            TonoExitCatalogHomeSocks5.self,
            forKey: .homeSocks5
        )
    }

    private enum CodingKeys: String, CodingKey {
        case homeProxy, defaultProxy, homeSocks5
    }
}
nonisolated struct TonoExitCatalogResponse: Codable, Sendable, Equatable {
    let revision: Int
    let yaml: String
    let sha256: String
    let updatedAt: Int?
    let routing: TonoExitCatalogRouting?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        revision = try container.decode(Int.self, forKey: .revision)
        yaml = try container.decode(String.self, forKey: .yaml)
        sha256 = try container.decode(String.self, forKey: .sha256)
        updatedAt = try container.decodeIfPresent(Int.self, forKey: .updatedAt)
        routing = try? container.decodeIfPresent(
            TonoExitCatalogRouting.self,
            forKey: .routing
        )
    }

    private enum CodingKeys: String, CodingKey {
        case revision, yaml, sha256, updatedAt, routing
    }
}
nonisolated struct TonoTrafficPolicyResponse: Codable, Sendable, Equatable {
    let revision: Int
    let json: String
    let sha256: String
    let updatedAt: Int?
    /// Ed25519 signature, standard base64, over
    /// `"tono-traffic-policy-v1\n" + json`, made offline by the holder of the
    /// policy signing key. Optional because every policy published before this
    /// existed is unsigned, and those must keep working: absent means validate
    /// against the compiled-in allowlist, which is what this build did before.
    /// Present and valid means the document's author is known, and hosts this
    /// build has never heard of may be honoured — that is what makes adding a
    /// domain a change to the server alone.
    let signature: String?
}
nonisolated struct TonoTrafficPolicy: Codable, Sendable, Equatable {
    let version: Int
    let domains: [TonoTrafficPolicyDomain]
    let mediaEndpoints: [TonoTrafficPolicyMediaEndpoint]
    /// Exact reviewed TCP IPv4 endpoints used by native WeChat HTTPDNS.
    /// These remain separate from UDP media endpoints so TCP IP routes can
    /// receive per-endpoint health fallbacks without widening UDP rules.
    let tcpEndpoints: [TonoTrafficPolicyMediaEndpoint]
    let webDomains: [TonoTrafficPolicyDomain]
    /// Version-3 suffix-level TCP direct rules. These deliberately do not
    /// resolve or pin IPs; the runtime emits exact allowlisted
    /// DOMAIN-SUFFIX rules instead.
    let directSuffixes: [TonoTrafficPolicyDomain]
    /// Runtime-only authorship state. This is deliberately not part of the
    /// server JSON: it becomes true only after the detached Ed25519 signature
    /// over those exact bytes verifies locally. Carrying it with the sanitized
    /// policy prevents later runtime validation from accidentally applying the
    /// unsigned, compiled-in allowlist a second time.
    let trusted: Bool

    init(
        version: Int,
        domains: [TonoTrafficPolicyDomain],
        mediaEndpoints: [TonoTrafficPolicyMediaEndpoint],
        tcpEndpoints: [TonoTrafficPolicyMediaEndpoint] = [],
        webDomains: [TonoTrafficPolicyDomain] = [],
        directSuffixes: [TonoTrafficPolicyDomain] = [],
        trusted: Bool = false
    ) {
        self.version = version
        self.domains = domains
        self.mediaEndpoints = mediaEndpoints
        self.tcpEndpoints = tcpEndpoints
        self.webDomains = webDomains
        self.directSuffixes = directSuffixes
        self.trusted = trusted
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        domains = try container.decode(
            [TonoTrafficPolicyDomain].self,
            forKey: .domains
        )
        mediaEndpoints = try container.decode(
            [TonoTrafficPolicyMediaEndpoint].self,
            forKey: .mediaEndpoints
        )
        tcpEndpoints = try container.decodeIfPresent(
            [TonoTrafficPolicyMediaEndpoint].self,
            forKey: .tcpEndpoints
        ) ?? []
        webDomains = try container.decodeIfPresent(
            [TonoTrafficPolicyDomain].self,
            forKey: .webDomains
        ) ?? []
        directSuffixes = try container.decodeIfPresent(
            [TonoTrafficPolicyDomain].self,
            forKey: .directSuffixes
        ) ?? []
        // Trust is never accepted from the document itself. The processor sets
        // it only after verifying the detached signature over the source JSON.
        trusted = false
    }

    private enum CodingKeys: String, CodingKey {
        case version, domains, mediaEndpoints, tcpEndpoints, webDomains,
             directSuffixes
    }
}
nonisolated struct TonoTrafficPolicyDomain: Codable, Sendable, Equatable {
    let host: String
    let ports: [Int]
}
nonisolated struct TonoTrafficPolicyMediaEndpoint: Codable, Sendable, Equatable {
    let address: String
    let ports: [Int]
}
nonisolated struct TonoEmptyResponse: Codable, Sendable {}
nonisolated struct TonoAppRoutingResearchResponse: Codable, Sendable {
    let snapshotId: String
    let receivedAt: Int
}

/// Receipt for one uploaded audit-log segment. The server answers a replay with
/// the identifier of the segment already stored, so the client advances its
/// cursor on both 200 and 201 and never needs to tell the two apart.
nonisolated struct TonoDiagnosticsLogSegmentResponse: Codable, Sendable {
    nonisolated struct Segment: Codable, Sendable {
        let id: String
        let receivedAt: Int
    }
    let segment: Segment
}

/// Periodic ops heartbeat. Same wire shape as Windows `telemetry/windows`.
nonisolated struct TonoTelemetryWindowReport: Encodable, Sendable {
    let schemaVersion: Int
    let kind: String
    let windowStartMs: Int64
    let windowEndMs: Int64
    let appVersion: String
    let osVersion: String
    let osArch: String
    let uiState: String
    let accountState: String
    let selectedServer: String?
    let catalogRevision: Int?
    let killSwitchMode: String?
    let killSwitchWanted: Bool?
    let killSwitchLive: Bool?
    let dnsEnabled: Bool?
    var exitDelayMs: Int64? = nil
    var tcpDelayMs: Int64? = nil
    var exitDelayAtMs: Int64? = nil
    var tcpDelayAtMs: Int64? = nil
    let eventCount: Int
    let eventsDropped: Int
    let events: [TonoTelemetryEvent]

    enum CodingKeys: String, CodingKey {
        case schemaVersion, kind, windowStartMs, windowEndMs, appVersion, osVersion
        case osArch, uiState, accountState, selectedServer, catalogRevision
        case killSwitchMode, killSwitchWanted, killSwitchLive, dnsEnabled
        case exitDelayMs, tcpDelayMs, exitDelayAtMs, tcpDelayAtMs
        case eventCount, eventsDropped, events
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schemaVersion, forKey: .schemaVersion)
        try container.encode(kind, forKey: .kind)
        try container.encode(windowStartMs, forKey: .windowStartMs)
        try container.encode(windowEndMs, forKey: .windowEndMs)
        try container.encode(appVersion, forKey: .appVersion)
        try container.encode(osVersion, forKey: .osVersion)
        try container.encode(osArch, forKey: .osArch)
        try container.encode(uiState, forKey: .uiState)
        try container.encode(accountState, forKey: .accountState)
        if let selectedServer { try container.encode(selectedServer, forKey: .selectedServer) }
        if let catalogRevision { try container.encode(catalogRevision, forKey: .catalogRevision) }
        if let killSwitchMode { try container.encode(killSwitchMode, forKey: .killSwitchMode) }
        if let killSwitchWanted { try container.encode(killSwitchWanted, forKey: .killSwitchWanted) }
        if let killSwitchLive { try container.encode(killSwitchLive, forKey: .killSwitchLive) }
        if let dnsEnabled { try container.encode(dnsEnabled, forKey: .dnsEnabled) }
        if let exitDelayMs { try container.encode(exitDelayMs, forKey: .exitDelayMs) }
        if let tcpDelayMs { try container.encode(tcpDelayMs, forKey: .tcpDelayMs) }
        if let exitDelayAtMs { try container.encode(exitDelayAtMs, forKey: .exitDelayAtMs) }
        if let tcpDelayAtMs { try container.encode(tcpDelayAtMs, forKey: .tcpDelayAtMs) }
        try container.encode(eventCount, forKey: .eventCount)
        try container.encode(eventsDropped, forKey: .eventsDropped)
        try container.encode(events, forKey: .events)
    }
}

nonisolated struct TonoTelemetryEvent: Encodable, Sendable {
    let ts: Int64
    let kind: String
    var stage: String? = nil
    var error: String? = nil
    var node: String? = nil
    var action: String? = nil
    var reason: String? = nil
    var probe: String? = nil
    var from: String? = nil
    var to: String? = nil
    var mode: String? = nil
    var reference: String? = nil
    var elapsedMs: Int64? = nil
    var delayMs: Int64? = nil
    var counter: Int64? = nil
    var restartCount: Int64? = nil
    var oldPid: Int64? = nil
    var newPid: Int64? = nil
    var revision: Int64? = nil
    var domains: Int64? = nil
    var media: Int64? = nil
    var webDomains: Int64? = nil
    var wechatTcp: Int64? = nil
    var webTcp: Int64? = nil
    var udp: Int64? = nil
    var endpoints: Int64? = nil
    var eventCount: Int64? = nil
    var bytes: Int64? = nil
    var wanted: Bool? = nil
    var live: Bool? = nil
    var generation: Int64? = nil
    var outcome: String? = nil
    var code: String? = nil
    var updateResume: Bool? = nil

    enum CodingKeys: String, CodingKey {
        case ts, kind, stage, error, node, action, reason, probe, from, to, mode
        case reference, elapsedMs, delayMs, counter, restartCount, oldPid, newPid
        case revision, domains, media, webDomains, wechatTcp, webTcp, udp
        case endpoints, eventCount, bytes, wanted, live, generation, outcome
        case code, updateResume
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(ts, forKey: .ts)
        try container.encode(kind, forKey: .kind)
        try container.encodeIfPresent(stage, forKey: .stage)
        try container.encodeIfPresent(error, forKey: .error)
        try container.encodeIfPresent(node, forKey: .node)
        try container.encodeIfPresent(action, forKey: .action)
        try container.encodeIfPresent(reason, forKey: .reason)
        try container.encodeIfPresent(probe, forKey: .probe)
        try container.encodeIfPresent(from, forKey: .from)
        try container.encodeIfPresent(to, forKey: .to)
        try container.encodeIfPresent(mode, forKey: .mode)
        try container.encodeIfPresent(reference, forKey: .reference)
        try container.encodeIfPresent(elapsedMs, forKey: .elapsedMs)
        try container.encodeIfPresent(delayMs, forKey: .delayMs)
        try container.encodeIfPresent(counter, forKey: .counter)
        try container.encodeIfPresent(restartCount, forKey: .restartCount)
        try container.encodeIfPresent(oldPid, forKey: .oldPid)
        try container.encodeIfPresent(newPid, forKey: .newPid)
        try container.encodeIfPresent(revision, forKey: .revision)
        try container.encodeIfPresent(domains, forKey: .domains)
        try container.encodeIfPresent(media, forKey: .media)
        try container.encodeIfPresent(webDomains, forKey: .webDomains)
        try container.encodeIfPresent(wechatTcp, forKey: .wechatTcp)
        try container.encodeIfPresent(webTcp, forKey: .webTcp)
        try container.encodeIfPresent(udp, forKey: .udp)
        try container.encodeIfPresent(endpoints, forKey: .endpoints)
        try container.encodeIfPresent(eventCount, forKey: .eventCount)
        try container.encodeIfPresent(bytes, forKey: .bytes)
        try container.encodeIfPresent(wanted, forKey: .wanted)
        try container.encodeIfPresent(live, forKey: .live)
        try container.encodeIfPresent(generation, forKey: .generation)
        try container.encodeIfPresent(outcome, forKey: .outcome)
        try container.encodeIfPresent(code, forKey: .code)
        try container.encodeIfPresent(updateResume, forKey: .updateResume)
    }
}

nonisolated struct TonoTelemetryWindowRequest: Encodable, Sendable {
    let window: TonoTelemetryWindowReport
}

nonisolated struct TonoPathLatency: Sendable {
    var exitDelayMs: Int64? = nil
    var tcpDelayMs: Int64? = nil
    var exitDelayAtMs: Int64? = nil
    var tcpDelayAtMs: Int64? = nil
}

nonisolated struct TonoTelemetryWindowReceipt: Decodable, Sendable {
    let id: String
    let receivedAt: Int?
}

nonisolated enum TonoDeviceActionName: String, Codable, Sendable {
    case diagnosticSnapshot = "diagnostic_snapshot"
    case claudeTrafficSnapshot = "claude_traffic_snapshot"
    case refreshCatalog = "refresh_catalog"
    case retryProtection = "retry_protection"
}
nonisolated struct TonoDeviceAction: Codable, Identifiable, Sendable {
    let id: String
    let action: TonoDeviceActionName
    let expiresAt: Int
}
nonisolated struct TonoDeviceActionsResponse: Codable, Sendable { let actions: [TonoDeviceAction] }
nonisolated struct TonoDiagnosticSnapshot: Codable, Sendable {
    let appVersion: String
    let build: String
    let connected: Bool
    let connecting: Bool
    let disconnecting: Bool
    let protectionBlocked: Bool
    let killSwitchArmed: Bool
    let utunPresent: Bool
    let protectedDNSConfigured: Bool
    let selectedExit: String
    let connectionStage: String
    let reconnectAttempt: Int
    let lastErrorCategory: String?
    /// Fixed label from `CrashSummary.labels` when the previous run of this
    /// session crashed. The control plane whitelists the same set.
    let lastCrashLabel: String?
    /// Revision of the managed exit catalog this client is actually running,
    /// or nil before one has been installed.
    ///
    /// The control plane has accepted this field all along and the periodic
    /// telemetry window sent a hardcoded nil, so operations could not answer
    /// "have clients picked up the catalog I just published" — the question that
    /// matters immediately after every publish, and the one that was guessed at
    /// wrongly during an incident because the only values in the database were
    /// stale leftovers from a reporting path that no longer runs.
    let catalogRevision: Int?
}
nonisolated struct TonoClaudeTrafficResearchEntry: Codable, Sendable {
    let service: String
    let client: String
    let host: String
    let network: String
    let port: Int
    let route: String
    let connections: Int
    let upBytes: Int64
    let downBytes: Int64
}
nonisolated struct TonoClaudeTrafficResearchSnapshot: Codable, Sendable {
    let observedSince: Int
    let droppedEndpointCount: Int
    let observedConnectionCount: Int
    let identifiedProcessConnectionCount: Int
    let proxiedConnectionCount: Int
    /// Official Claude/Anthropic connections whose live chain explicitly
    /// contained the residential outbound. Kept separate from generic proxy.
    let residentialConnectionCount: Int
    let directConnectionCount: Int
    let blockedConnectionCount: Int
    let directRouteAttemptCount: Int
    let managedDirectRouteCount: Int
    let unclassifiedRouteCount: Int
    let unsafeProtectionObservationCount: Int
    let webManagedDirectConnectionCount: Int
    let weChatConnectionCount: Int
    let weChatManagedDirectConnectionCount: Int
    let weChatProxiedConnectionCount: Int
    let weChatBlockedConnectionCount: Int
    let weChatEndpointUnknownProcessConnectionCount: Int
    let unknownManagedDirectConnectionCount: Int
    let otherManagedDirectConnectionCount: Int
    let protectedDirectConnectionCount: Int
    let connectionLimitReached: Bool
    let connected: Bool
    let killSwitchArmed: Bool
    let tunPresent: Bool
    let protectedDNSConfigured: Bool
    let exitIdentityConsistency: String
    let physicalBypassProbe: String
    let entries: [TonoClaudeTrafficResearchEntry]
}
nonisolated struct TonoDeviceActionResult: Codable, Sendable {
    let outcome: String
    let message: String?
    let snapshot: TonoDiagnosticSnapshot?
    let trafficResearch: TonoClaudeTrafficResearchSnapshot?
}
nonisolated struct TonoDeviceActionResultResponse: Codable, Sendable { let action: TonoDeviceAction }

nonisolated struct TonoAuthMethod: Codable, Sendable, Equatable {
    let enabled: Bool
    let clientId: String?
}

nonisolated struct TonoAuthMethodsResponse: Codable, Sendable, Equatable {
    let email: TonoAuthMethod
    let apple: TonoAuthMethod
    let google: TonoAuthMethod
}

nonisolated struct TonoEmailStartRequest: Codable, Sendable {
    let email: String
    let deviceName: String
    let installationId: String
}

nonisolated struct TonoEmailChallengeResponse: Codable, Sendable, Equatable {
    let challengeId: String
    let expiresIn: Int
    let message: String
}

nonisolated struct TonoEmailVerifyRequest: Codable, Sendable {
    let challengeId: String
    let code: String
}

nonisolated struct TonoOIDCChallengeRequest: Codable, Sendable {
    let provider: String
    let deviceName: String
    let installationId: String
}

nonisolated struct TonoOIDCChallengeResponse: Codable, Sendable, Equatable {
    let challengeId: String
    let nonce: String
    let expiresIn: Int
    let audience: String
}

nonisolated struct TonoOIDCVerifyRequest: Codable, Sendable {
    let provider: String
    let challengeId: String
    let idToken: String
}

nonisolated struct TonoRefreshRequest: Codable, Sendable { let refreshToken: String }
nonisolated struct TonoLogoutRequest: Codable, Sendable { let refreshToken: String? }
nonisolated struct TonoEnrollmentRequest: Codable, Sendable { let installationId: String }
/// Confirm body uses the three distinct Tailscale identities:
/// - stableNodeId: status Self.ID (stable)
/// - nodeId: Device API nodeId when known (optional on client)
/// - publicKey: status Self.PublicKey for inventory disambiguation
/// Worker resolves the management device id from the tailnet inventory.
nonisolated struct TonoConfirmRequest: Codable, Sendable {
    let stableNodeId: String
    let nodeId: String?
    let publicKey: String
    let tailscaleIPs: [String]
}

nonisolated enum TonoCoding {
    nonisolated static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds)
            }
            let value = try container.decode(String.self)
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid Tono date")
        }
        return decoder
    }

    nonisolated static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
