import Foundation

nonisolated enum UpdateHandoffPhase: String, Codable, Sendable, CaseIterable {
    case idle
    case updatePrepared
    case connectionQuiescing
    case cleanShutdownCompleted
    case protectedHandoffRecorded
    case installStarted
    case firstLaunchMigration
    case protectionResuming
    case verified
    case committed
    case failed
}

nonisolated struct UpdateHandoffJournal: Codable, Equatable, Sendable {
    var phase: UpdateHandoffPhase
    var previousAppVersion: String
    var nextAppVersion: String
    var coreVersion: String
    var coreSHA256: String
    var buildCommit: String
    var helperProtocolVersion: String
    var wasConnected: Bool
    var keepKillSwitchArmed: Bool
    var selectedNodeAnonymousId: String?
    var catalogRevision: Int?
    var connectionGeneration: UInt64
    var createdAt: Date
    var updatedAt: Date
    var expiresAt: Date
    var allowCachedResume: Bool
    var lastErrorCode: String?
    var lastErrorStage: String?

    static let schemaVersion = 1

    enum CodingKeys: String, CodingKey {
        case schemaVersion
        case phase
        case previousAppVersion
        case nextAppVersion
        case coreVersion
        case coreSHA256
        case buildCommit
        case helperProtocolVersion
        case wasConnected
        case keepKillSwitchArmed
        case selectedNodeAnonymousId
        case catalogRevision
        case connectionGeneration
        case createdAt
        case updatedAt
        case expiresAt
        case allowCachedResume
        case lastErrorCode
        case lastErrorStage
    }

    init(
        phase: UpdateHandoffPhase,
        previousAppVersion: String,
        nextAppVersion: String,
        coreVersion: String,
        coreSHA256: String,
        buildCommit: String,
        helperProtocolVersion: String,
        wasConnected: Bool,
        keepKillSwitchArmed: Bool,
        selectedNodeAnonymousId: String?,
        catalogRevision: Int?,
        connectionGeneration: UInt64,
        createdAt: Date = Date(),
        updatedAt: Date = Date(),
        expiresAt: Date = Date().addingTimeInterval(48 * 60 * 60),
        allowCachedResume: Bool = true,
        lastErrorCode: String? = nil,
        lastErrorStage: String? = nil
    ) {
        self.phase = phase
        self.previousAppVersion = previousAppVersion
        self.nextAppVersion = nextAppVersion
        self.coreVersion = coreVersion
        self.coreSHA256 = coreSHA256
        self.buildCommit = buildCommit
        self.helperProtocolVersion = helperProtocolVersion
        self.wasConnected = wasConnected
        self.keepKillSwitchArmed = keepKillSwitchArmed
        self.selectedNodeAnonymousId = selectedNodeAnonymousId
        self.catalogRevision = catalogRevision
        self.connectionGeneration = connectionGeneration
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.expiresAt = expiresAt
        self.allowCachedResume = allowCachedResume
        self.lastErrorCode = lastErrorCode
        self.lastErrorStage = lastErrorStage
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let version = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        guard version == Self.schemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion,
                in: container,
                debugDescription: "unsupported update journal schema"
            )
        }
        phase = try container.decode(UpdateHandoffPhase.self, forKey: .phase)
        previousAppVersion = try container.decode(String.self, forKey: .previousAppVersion)
        nextAppVersion = try container.decode(String.self, forKey: .nextAppVersion)
        coreVersion = try container.decode(String.self, forKey: .coreVersion)
        coreSHA256 = try container.decode(String.self, forKey: .coreSHA256)
        buildCommit = try container.decode(String.self, forKey: .buildCommit)
        helperProtocolVersion = try container.decode(String.self, forKey: .helperProtocolVersion)
        wasConnected = try container.decode(Bool.self, forKey: .wasConnected)
        keepKillSwitchArmed = try container.decode(Bool.self, forKey: .keepKillSwitchArmed)
        selectedNodeAnonymousId = try container.decodeIfPresent(String.self, forKey: .selectedNodeAnonymousId)
        catalogRevision = try container.decodeIfPresent(Int.self, forKey: .catalogRevision)
        connectionGeneration = try container.decode(UInt64.self, forKey: .connectionGeneration)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decode(Date.self, forKey: .updatedAt)
        expiresAt = try container.decode(Date.self, forKey: .expiresAt)
        allowCachedResume = try container.decode(Bool.self, forKey: .allowCachedResume)
        lastErrorCode = try container.decodeIfPresent(String.self, forKey: .lastErrorCode)
        lastErrorStage = try container.decodeIfPresent(String.self, forKey: .lastErrorStage)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(Self.schemaVersion, forKey: .schemaVersion)
        try container.encode(phase, forKey: .phase)
        try container.encode(previousAppVersion, forKey: .previousAppVersion)
        try container.encode(nextAppVersion, forKey: .nextAppVersion)
        try container.encode(coreVersion, forKey: .coreVersion)
        try container.encode(coreSHA256, forKey: .coreSHA256)
        try container.encode(buildCommit, forKey: .buildCommit)
        try container.encode(helperProtocolVersion, forKey: .helperProtocolVersion)
        try container.encode(wasConnected, forKey: .wasConnected)
        try container.encode(keepKillSwitchArmed, forKey: .keepKillSwitchArmed)
        try container.encodeIfPresent(selectedNodeAnonymousId, forKey: .selectedNodeAnonymousId)
        try container.encodeIfPresent(catalogRevision, forKey: .catalogRevision)
        try container.encode(connectionGeneration, forKey: .connectionGeneration)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(expiresAt, forKey: .expiresAt)
        try container.encode(allowCachedResume, forKey: .allowCachedResume)
        try container.encodeIfPresent(lastErrorCode, forKey: .lastErrorCode)
        try container.encodeIfPresent(lastErrorStage, forKey: .lastErrorStage)
    }

    var isExpired: Bool { Date() > expiresAt }

    /// Recorded instead of the requested phase when a transition is refused.
    static let illegalPhaseErrorCode = "TONO_JOURNAL_ILLEGAL_PHASE"

    static func allowedNext(_ from: UpdateHandoffPhase, _ to: UpdateHandoffPhase) -> Bool {
        if from == to { return true }
        switch (from, to) {
        case (.idle, .updatePrepared),
             (.updatePrepared, .connectionQuiescing),
             (.connectionQuiescing, .cleanShutdownCompleted),
             (.cleanShutdownCompleted, .protectedHandoffRecorded),
             // A Mac that was not protected when the install began has no
             // protected handoff to record, so the install starts straight
             // from the clean shutdown.
             (.cleanShutdownCompleted, .installStarted),
             (.protectedHandoffRecorded, .installStarted),
             (.installStarted, .firstLaunchMigration),
             (.firstLaunchMigration, .protectionResuming),
             // Nothing to resume on a Mac that was not protected: the first
             // launch after the install verifies the new build directly.
             (.firstLaunchMigration, .verified),
             (.protectionResuming, .verified),
             (.verified, .committed):
            return true
        case (_, .failed):
            return true
        default:
            return false
        }
    }

    func canAdvance(to phase: UpdateHandoffPhase) -> Bool {
        Self.allowedNext(self.phase, phase)
    }

    /// True when the last advance was refused rather than recording a real
    /// update failure.
    var refusedIllegalTransition: Bool {
        lastErrorCode == Self.illegalPhaseErrorCode
    }

    /// A refused transition records why it was refused and leaves the phase
    /// where the update actually is. Rewriting the phase to `failed` here made
    /// every later transition illegal too, so one out-of-order call poisoned
    /// the rest of the handoff and persisted a state the update never reached.
    func advancing(to phase: UpdateHandoffPhase, errorCode: String? = nil, errorStage: String? = nil) -> UpdateHandoffJournal {
        var next = self
        if Self.allowedNext(self.phase, phase) {
            next.phase = phase
            next.lastErrorCode = errorCode
            next.lastErrorStage = errorStage
        } else {
            next.lastErrorCode = errorCode ?? Self.illegalPhaseErrorCode
            next.lastErrorStage = errorStage ?? "\(self.phase.rawValue)->\(phase.rawValue)"
        }
        next.updatedAt = Date()
        return next
    }
}

enum UpdateHandoffStore {
    static var fileURL: URL {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        return root
            .appendingPathComponent(AppProfile.appSupportDirectoryName, isDirectory: true)
            .appendingPathComponent("update-handoff.json")
    }

    static func load() -> UpdateHandoffJournal? {
        let url = fileURL
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let data = try Data(contentsOf: url)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let journal = try decoder.decode(UpdateHandoffJournal.self, from: data)
            if journal.isExpired || journal.phase == .committed || journal.phase == .idle {
                try? FileManager.default.removeItem(at: url)
                return nil
            }
            return journal
        } catch {
            return nil
        }
    }

    static func write(_ journal: UpdateHandoffJournal) throws {
        let url = fileURL
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(journal)
        let temp = url.deletingLastPathComponent()
            .appendingPathComponent("update-handoff.\(UUID().uuidString).tmp")
        try data.write(to: temp, options: .atomic)
        if FileManager.default.fileExists(atPath: url.path) {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: temp)
        } else {
            try FileManager.default.moveItem(at: temp, to: url)
        }
    }

    static func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
