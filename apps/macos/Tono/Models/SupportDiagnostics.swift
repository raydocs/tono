import Foundation

/// The existing schemaVersion=1 /diagnostics/reports allow-list. Local build,
/// attempt and runtime identities deliberately do not conform to this payload.
nonisolated struct TonoSupportReport: Codable, Sendable {
    struct Step: Codable, Sendable {
        let key: String
        let state: String
        let elapsedMs: Int?
    }
    let schemaVersion = 1
    let reportedAtMs: Int64
    let appVersion: String
    let osVersion: String
    let osArch: String
    let serviceProtocol: String?
    let serviceBuild: String?
    let uiState: String
    let accountState: String
    let selectedServer: String?
    let catalogRevision: Int?
    let killSwitchMode: String?
    let killSwitchWanted: Bool?
    let killSwitchLive: Bool?
    let killSwitchLastError: String?
    let dnsEnabled: Bool?
    let dnsLastError: String?
    let failedStage: String?
    let error: String?
    let retryAttempt: Int
    let totalElapsedMs: Int?
    let steps: [Step]
    let virtualAdapters: [String]
    let auditLogPath: String
    let serviceLogPath: String
}

nonisolated struct TonoSupportReportRequest: Encodable, Sendable {
    let report: TonoSupportReport

    func preview() throws -> String {
        let encoder = TonoCoding.encoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return String(decoding: try encoder.encode(self), as: UTF8.self)
    }
}

nonisolated struct TonoSupportReceipt: Decodable, Sendable {
    let referenceCode: String
    let receivedAt: Int64?
}

nonisolated struct AppBuildSource: Codable, Sendable {
    let commit: String?
    let dirty: Bool?
    let configuration: String

    static func read(bundle: Bundle = .main) -> Self? {
        guard let url = bundle.url(forResource: "tono-build-source", withExtension: "json"),
              let data = try? Data(contentsOf: url), data.count < 1_024,
              let source = try? JSONDecoder().decode(Self.self, from: data),
              ["Debug", "Release", "Unknown"].contains(source.configuration),
              source.commit == nil || source.commit?.range(of: "^[0-9a-f]{40}$", options: .regularExpression) != nil
        else { return nil }
        return source
    }

    /// Configuration and source metadata are not signing or notarization evidence.
    var description: String {
        "\(configuration) · \(commit ?? "unknown") · dirty=\(dirty.map(String.init) ?? "unknown")"
    }
}

nonisolated struct SupportRuntimeEvidence: Sendable {
    var helperInstalled = false
    var helperVersion: String?
    var helperRejectsApp = false
    var coreRunning: Bool?
    var corePID: Int?
    var dnsConfigured: Bool?

    static func collect() async -> Self {
        await Task.detached(priority: .utility) {
            let version = HelperManager.currentVersion()
            let core = HelperManager.coreStatus()
            let dns = HelperManager.protectedDNSStatus()
            return Self(
                helperInstalled: HelperManager.hasInstalledHelperArtifact,
                helperVersion: version,
                helperRejectsApp: version == nil && HelperManager.daemonRejectsClient(),
                coreRunning: core.verified ? core.running : nil,
                corePID: core.verified ? core.pid : nil,
                dnsConfigured: dns.available ? dns.configured : nil
            )
        }.value
        // Do NOT query /killswitch/status here: that endpoint heals PF, flushes
        // states and can change routing. A health check must be observation-only.
    }
}

struct LocalHealthCheck: Identifiable {
    struct Finding: Identifiable {
        enum Status { case observed, attention, unknown }
        let id: String
        let title: String
        let status: Status
        let detail: String
    }
    let id = UUID()
    let observedAt: Date
    let accountRevision: UInt64?
    let owner: String?
    let generation: UInt64
    let attempt: UUID?
    let snapshot: TonoDiagnosticSnapshot
    let runtime: SupportRuntimeEvidence
    let findings: [Finding]
    let request: TonoSupportReportRequest
    /// Shown locally and copied beside the receipt; never sent to the server.
    let localIdentity: String
}

/// One explicit preview/confirmation authorization. Synchronously revoked at
/// the AccountSession read boundary, including sign-out before any await.
nonisolated final class SupportReportLease: @unchecked Sendable {
    private let lock = NSLock()
    private var valid = true
    func revoke() { lock.lock(); defer { lock.unlock() }; valid = false }
    func isCurrent() -> Bool { lock.lock(); defer { lock.unlock() }; return valid }
}

struct SupportReportDraft: Identifiable {
    let id = UUID()
    let health: LocalHealthCheck
    let preview: String
    let lease: SupportReportLease
}

struct SupportReportReceipt {
    let draftID: UUID
    let server: TonoSupportReceipt
    let localIdentity: String
    var copyText: String {
        "\(server.referenceCode)\nreceivedAt: \(server.receivedAt.map(String.init) ?? "unknown")\n\(localIdentity)"
    }
}
