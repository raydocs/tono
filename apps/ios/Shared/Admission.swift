import CryptoKit
import Foundation
#if canImport(Tonomobile)
import Tonomobile
#endif

enum PolicyAdmission {
    static let publicKey = "Sf2burVHXZWzYikU0FlC+N64BeRZJxJe8XaneblmTkM="
    static let context = "tono-traffic-policy-v1\n"

    /// Integrity/authorship is necessary, NOT equivalent to iOS capability admission.
    static func verify(_ envelope: PolicyEnvelope, previousRevision: Int?) throws -> TrafficPolicy {
        guard envelope.revision >= 0,
              previousRevision.map({ envelope.revision >= $0 }) ?? true,
              envelope.json.utf8.count <= 1_048_576,
              digest(Data(envelope.json.utf8)) == envelope.sha256,
              let signature = envelope.signature.flatMap({ Data(base64Encoded: $0) }),
              let keyData = Data(base64Encoded: publicKey),
              let key = try? Curve25519.Signing.PublicKey(rawRepresentation: keyData),
              key.isValidSignature(signature, for: Data((context + envelope.json).utf8)) else {
            throw Blocker.invalidPolicy
        }
        let data = Data(envelope.json.utf8)
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys).isSubset(of: ["version", "domains", "mediaEndpoints", "tcpEndpoints", "webDomains", "directSuffixes"]) else {
            throw Blocker.unsupportedPolicy
        }
        let policy = try JSONDecoder().decode(TrafficPolicy.self, from: data)
        guard (1...4).contains(policy.version) else { throw Blocker.unsupportedPolicy }
        // iOS cannot reproduce desktop process-identity DIRECT leases. Never strip them.
        guard policy.domains.isEmpty, policy.mediaEndpoints.isEmpty,
              (policy.tcpEndpoints ?? []).isEmpty, (policy.webDomains ?? []).isEmpty,
              (policy.directSuffixes ?? []).isEmpty else { throw Blocker.unsupportedPolicy }
        return policy
    }

    static func verifyCatalog(_ catalog: CatalogEnvelope) throws {
        guard catalog.revision >= 0, catalog.yaml.utf8.count <= 8_388_608,
              digest(Data(catalog.yaml.utf8)) == catalog.sha256 else { throw Blocker.invalidPolicy }
        // No YAML parser/emitter or raw-routing admission bridge exists on iOS yet.
        // A successful digest check must NEVER be treated as an admitted node list.
        throw Blocker.catalogAdapterUnavailable
    }

    static func digest(_ bytes: Data) -> String {
        // services/control-plane/src/crypto.ts sha256: unpadded base64url, not hex.
        Data(SHA256.hash(data: bytes)).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum SingBoxIdentity {
    static let version = "1.15.0-alpha.3"
    static let commit = "93fff5954390367dd456cad3cbd79be54f8b941f"
    static let goVersion = "go1.27.1"
    static let cgoEnabled = "0"
    static let tags = ["with_gvisor", "with_quic", "with_utls", "with_clash_api"]

    static func requireEmbeddedCore() throws {
        #if canImport(Tonomobile)
        // Set only by the pinned artifact's generated xcconfig. Build tooling
        // hashes the framework before Xcode; code signing seals the final image.
        guard let identity = Bundle.main.object(forInfoDictionaryKey: "TonoMobileIdentity") as? String,
              identity.count == 64, identity.allSatisfy({ $0.isHexDigit }),
              TonomobileIdentity() == identity else { throw Blocker.artifactMismatch }
        #else
        throw Blocker.coreUnavailable
        #endif
    }
}
