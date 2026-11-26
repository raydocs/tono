import CryptoKit
import XCTest
@testable import Tono

/// #317 (internal review H3-F5): the policy signature covers `context + json`,
/// but the revision gate read the envelope `revision`, which nothing signs. A
/// genuinely signed historical document replayed under a forged, very large
/// revision became the ceiling for every later genuine revision. Only a
/// revision named inside the signed json is evidence of order now, and a json
/// that names a different revision than its envelope is refused whole.
final class ManagedTrafficPolicyRevisionTests: XCTestCase {

    func testSignedRevisionOutranksAnUnsignedRevisionPin() async throws {
        // A throwaway keypair; the gate is the same one production runs with the
        // compiled-in key.
        let signing = Curve25519.Signing.PrivateKey()
        let key = signing.publicKey.rawRepresentation.base64EncodedString()
        func cache(_ revision: Int, _ json: String, signed: Bool) throws -> ManagedTrafficPolicyCache {
            var signature: String?
            if signed {
                signature = try signing.signature(
                    for: Data((ManagedTrafficPolicySignature.context + json).utf8)
                ).base64EncodedString()
            }
            let digest = Data(SHA256.hash(data: Data(json.utf8))).base64EncodedString()
                .replacingOccurrences(of: "=", with: "")
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
            return ManagedTrafficPolicyCache(
                revision: revision,
                json: json,
                sha256: digest,
                updatedAt: nil,
                signature: signature
            )
        }
        func authenticated(_ cache: ManagedTrafficPolicyCache) -> Bool {
            ManagedTrafficPolicySignature.revisionIsAuthenticated(cache, publicKeyBase64: key)
        }
        func order(
            _ candidate: ManagedTrafficPolicyCache,
            over current: ManagedTrafficPolicyCache
        ) -> ManagedTrafficPolicySignature.RevisionOrder {
            ManagedTrafficPolicySignature.revisionOrder(
                candidate: candidate.revision,
                candidateAuthenticated: authenticated(candidate),
                current: current.revision,
                currentAuthenticated: authenticated(current)
            )
        }

        // A genuinely signed legacy document replayed under a forged revision:
        // nothing signed says which revision it was.
        let legacy = #"{"version":1,"domains":[],"mediaEndpoints":[]}"#
        let pinned = try cache(1 << 53, legacy, signed: true)
        XCTAssertFalse(authenticated(pinned))

        // The next genuine publish names its revision inside the signed bytes.
        // A number nobody signed does not outrank it, and once it is installed
        // the replay cannot move the gate back. Both answers come from the
        // document and its signature alone, which is what the disk cache keeps,
        // so they are the same after a restart.
        let bound = #"{"version":1,"domains":[],"mediaEndpoints":[],"revision":4}"#
        let genuine = try cache(4, bound, signed: true)
        XCTAssertTrue(authenticated(genuine))
        XCTAssertEqual(order(genuine, over: pinned), .newer)
        XCTAssertEqual(order(pinned, over: genuine), .stale)
        let unsignedReplay = try cache(1 << 53, legacy, signed: false)
        XCTAssertEqual(order(unsignedReplay, over: genuine), .stale)

        // The envelope cannot relabel a document that names its own revision:
        // not authenticated, and refused whole rather than installed.
        XCTAssertFalse(authenticated(try cache(5, bound, signed: true)))
        let relabelled = try cache(5, bound, signed: false)
        do {
            _ = try await ManagedTrafficPolicyProcessor().validate(
                relabelled,
                protectedAddresses: []
            )
            XCTFail("a json naming revision 4 was accepted as revision 5")
        } catch {}
    }

    func testProductionKeyAndLegacyFallbackAreValid32ByteKeys() {
        let primary = Data(base64Encoded: ManagedTrafficPolicySignature.publicKeyBase64)
        let legacy = Data(base64Encoded: ManagedTrafficPolicySignature.legacyFallbackKeyBase64)
        XCTAssertEqual(primary?.count, 32)
        XCTAssertEqual(legacy?.count, 32)
        XCTAssertNotEqual(primary, legacy)
    }

    func testValidationRejectionReasonClassifiesEnvelopeFailures() {
        let json = #"{"version":1,"domains":[],"mediaEndpoints":[]}"#
        let digest = Data(SHA256.hash(data: Data(json.utf8))).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        XCTAssertNil(ManagedTrafficPolicyProcessor.validationRejectionReason(
            ManagedTrafficPolicyCache(revision: 1, json: json, sha256: digest, updatedAt: nil, signature: nil)
        ))
        XCTAssertEqual(ManagedTrafficPolicyProcessor.validationRejectionReason(
            ManagedTrafficPolicyCache(revision: -1, json: json, sha256: digest, updatedAt: nil, signature: nil)
        ), "invalid_revision")
        XCTAssertEqual(ManagedTrafficPolicyProcessor.validationRejectionReason(
            ManagedTrafficPolicyCache(revision: 1, json: json, sha256: "wrong", updatedAt: nil, signature: nil)
        ), "digest_mismatch")
        let badJson = "not-json"
        let badDigest = Data(SHA256.hash(data: Data(badJson.utf8))).base64EncodedString()
            .replacingOccurrences(of: "=", with: "")
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
        XCTAssertEqual(ManagedTrafficPolicyProcessor.validationRejectionReason(
            ManagedTrafficPolicyCache(revision: 1, json: badJson, sha256: badDigest, updatedAt: nil, signature: nil)
        ), "decode_failed")
    }
}
