import Foundation
import CryptoKit

/// Inactive value contract, shared with tono-core/update_contract.rs. Decoding
/// does not authenticate a manifest/receipt. No installer, storage or PF effects.
/// Privileged integration obligations: docs/UPDATE_PROTOCOL_V1.md.
nonisolated enum UpdateContractV1 {
    static let maxBytes = 16_384
    static let maxInteger: UInt64 = 9_007_199_254_740_991

    enum ContractError: String, Error {
        case document, binding, time, generation, phase, evidence
    }

    enum TargetId: String, Codable, Sendable {
        case macosArm64 = "macos-arm64"
        case windowsX86_64 = "windows-x86_64"
    }

    struct Components: Codable, Equatable, Sendable {
        let appSha256: String
        let coreSha256: String
        let privilegedSha256: String
    }

    struct Target: Codable, Equatable, Sendable {
        let artifactSha256: String
        let artifactSizeBytes: UInt64
        let components: Components
        let id: TargetId
    }

    struct ReleaseManifest: Codable, Equatable, Sendable {
        let appVersion: String
        let buildCommit: String
        let kind: String
        let protocolVersion: UInt32
        let releaseId: String
        let releaseSequence: UInt64
        let targets: [Target]

        /// Shape only; native signatures and downgrade policy are NOT checked.
        static func decode(_ bytes: Data) throws -> Self {
            let value: Self = try decodeCanonical(bytes)
            try value.validate()
            return value
        }

        func validate() throws {
            guard kind == "tonoUpdateManifest", protocolVersion == 1,
                  identifier(appVersion, max: 64), identifier(releaseId, max: 128),
                  (1...maxInteger).contains(releaseSequence),
                  hex(buildCommit, size: 40), targets.count == 2,
                  targets[0].id != targets[1].id,
                  targets.allSatisfy({ target in
                      hex(target.artifactSha256, size: 64)
                          && (1...4_294_967_296).contains(target.artifactSizeBytes)
                          && hex(target.components.appSha256, size: 64)
                          && hex(target.components.coreSha256, size: 64)
                          && hex(target.components.privilegedSha256, size: 64)
                  }) else { throw ContractError.document }
        }

        func sha256() throws -> String {
            try validate()
            return SHA256.hash(data: try canonical(self)).map { String(format: "%02x", $0) }.joined()
        }

        func target(_ id: TargetId) throws -> Target {
            guard let value = targets.first(where: { $0.id == id }) else { throw ContractError.binding }
            return value
        }
    }

    enum Phase: String, Codable, Sendable {
        case preparing, installationAuthorized, installedIdentityVerified, recoveryVerified, committed
    }

    enum Protection: String, Codable, Sendable {
        case unknown, unprotected, protectedOffline, connected
    }

    enum BlockReason: String, Codable, Sendable {
        case preparationFailed, installationUncertain, recoveryFailed, cancelled
    }

    struct Receipt: Codable, Equatable, Sendable {
        let attemptId: String
        var blockedReason: BlockReason?
        let createdAtUnix: UInt64
        let expiresAtUnix: UInt64
        let initiatingGeneration: UInt64
        let installedLocationSha256: String
        let kind: String
        let manifestSha256: String
        let owner: String
        var phase: Phase
        let protocolVersion: UInt32
        let requiredRecovery: Protection
        var successorGeneration: UInt64?
        let targetId: TargetId
        var updatedAtUnix: UInt64

        static func decode(_ bytes: Data, manifest: ReleaseManifest) throws -> Self {
            let value: Self = try decodeCanonical(bytes)
            try value.validate(manifest: manifest)
            return value
        }

        private func validate(manifest: ReleaseManifest) throws {
            let needsSuccessor = phase == .installedIdentityVerified || phase == .recoveryVerified || phase == .committed
            guard kind == "tonoUpdateReceipt", protocolVersion == 1,
                  hex(attemptId, size: 64), hex(installedLocationSha256, size: 64),
                  identifier(owner, max: 128), manifestSha256 == (try manifest.sha256()),
                  createdAtUnix > 0, createdAtUnix <= updatedAtUnix,
                  updatedAtUnix < expiresAtUnix, expiresAtUnix <= maxInteger,
                  expiresAtUnix - createdAtUnix <= 172_800,
                  initiatingGeneration > 0, initiatingGeneration <= maxInteger,
                  needsSuccessor == (successorGeneration != nil),
                  successorGeneration.map({ $0 > initiatingGeneration && $0 <= maxInteger }) ?? true,
                  phase == .preparing || requiredRecovery != .unknown,
                  phase != .committed || blockedReason == nil else { throw ContractError.document }
            _ = try manifest.target(targetId)
        }

        /// A pure proposal, NOT durable progress. Serialize and atomically persist
        /// under the privileged owner's lock before acknowledging or acting.
        func propose(manifest: ReleaseManifest, context: Context, observation: Observation) throws -> Self {
            try validate(manifest: manifest)
            guard context.attemptId == attemptId, context.owner == owner,
                  context.installedLocationSha256 == installedLocationSha256,
                  context.targetId == targetId else { throw ContractError.binding }
            guard context.nowUnix >= updatedAtUnix, context.nowUnix < expiresAtUnix else { throw ContractError.time }
            guard blockedReason == nil, phase != .committed else { throw ContractError.phase }
            let adopting: Bool
            if case .installedIdentityVerified = observation {
                adopting = phase == .installationAuthorized
            } else {
                adopting = false
            }
            guard context.generation > 0, context.generation <= maxInteger,
                  adopting ? context.generation > initiatingGeneration
                    : context.generation == (successorGeneration ?? initiatingGeneration) else {
                throw ContractError.generation
            }
            let target = try manifest.target(targetId)
            var next = self
            switch (phase, observation) {
            case let (.preparing, .preparationVerified(artifactSha256, protection)):
                let expected: Protection
                switch requiredRecovery {
                case .connected, .protectedOffline: expected = .protectedOffline
                case .unprotected: expected = .unprotected
                case .unknown: throw ContractError.evidence
                }
                guard artifactSha256 == target.artifactSha256, protection == expected else { throw ContractError.evidence }
                next.phase = .installationAuthorized
            case let (.installationAuthorized, .installedIdentityVerified(components)):
                guard components == target.components else { throw ContractError.evidence }
                next.phase = .installedIdentityVerified
                next.successorGeneration = context.generation
            case let (.installedIdentityVerified, .recoveryVerified(components, protection)),
                 let (.recoveryVerified, .commitVerified(components, protection)):
                guard components == target.components, protection == requiredRecovery else { throw ContractError.evidence }
                next.phase = phase == .recoveryVerified ? .committed : .recoveryVerified
            case let (_, .block(reason)):
                next.blockedReason = reason
            case (_, .applicationContinuationRequested): throw ContractError.evidence
            default: throw ContractError.phase
            }
            next.updatedAtUnix = context.nowUnix
            return next
        }
    }

    /// Local facts from native verification, never decoded from App IPC. Naming
    /// a fact or constructing this value does not itself prove it happened.
    enum Observation: Sendable {
        case preparationVerified(artifactSha256: String, protection: Protection)
        case installedIdentityVerified(components: Components)
        case recoveryVerified(components: Components, protection: Protection)
        case commitVerified(components: Components, protection: Protection)
        case applicationContinuationRequested
        case block(BlockReason)
    }

    /// Independently authenticated native context, not values echoed from an
    /// App request or copied from the receipt being checked. Not Codable.
    struct Context: Sendable {
        let attemptId: String
        let owner: String
        let installedLocationSha256: String
        let targetId: TargetId
        let generation: UInt64
        let nowUnix: UInt64
    }

    /// This ASCII model uses compact sorted-key JSON and exactly one trailing LF.
    /// Re-encoding rejects ignored/duplicate keys, null optionals, alternate
    /// escapes, floats and trailing data that Foundation may otherwise accept.
    static func canonical<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var bytes = try encoder.encode(value)
        bytes.append(0x0a)
        return bytes
    }

    private static func decodeCanonical<T: Codable>(_ bytes: Data) throws -> T {
        guard bytes.count <= maxBytes else { throw ContractError.document }
        do {
            let value = try JSONDecoder().decode(T.self, from: bytes)
            guard try canonical(value) == bytes else { throw ContractError.document }
            return value
        } catch { throw ContractError.document }
    }

    private static func hex(_ value: String, size: Int) -> Bool {
        value.utf8.count == size && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    private static func identifier(_ value: String, max: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= max && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || [46, 95, 58, 45].contains($0)
        }
    }
}
