import XCTest
@testable import Tono

final class AdmissionTests: XCTestCase {
    private struct WorkerFixture: Decodable {
        let catalog: CatalogEnvelope
        let policy: PolicyEnvelope
    }

    private func workerFixture() throws -> WorkerFixture {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "admission", withExtension: "json"))
        return try JSONDecoder().decode(WorkerFixture.self, from: Data(contentsOf: url))
    }

    func testUnsignedPolicyCannotGrantDirectTraffic() {
        let json = #"{"version":3,"domains":[],"mediaEndpoints":[],"directSuffixes":[{"host":"example.com","ports":[443]}]}"#
        let envelope = PolicyEnvelope(revision: 1, json: json, sha256: PolicyAdmission.digest(Data(json.utf8)), signature: nil)
        XCTAssertThrowsError(try PolicyAdmission.verify(envelope, previousRevision: nil)) {
            XCTAssertEqual($0 as? Blocker, .invalidPolicy)
        }
    }

    func testAuthenticatedCatalogBytesAreNotAnAdmittedConfiguration() throws {
        let envelope = try workerFixture().catalog
        // Produced by the actual Worker crypto.ts sha256, not the Swift implementation.
        XCTAssertEqual(PolicyAdmission.digest(Data(envelope.yaml.utf8)), envelope.sha256)
        XCTAssertThrowsError(try PolicyAdmission.verifyCatalog(envelope)) {
            XCTAssertEqual($0 as? Blocker, .catalogAdapterUnavailable)
        }
        let tampered = CatalogEnvelope(revision: envelope.revision, yaml: envelope.yaml + "\n",
                                       sha256: envelope.sha256, routing: envelope.routing)
        XCTAssertThrowsError(try PolicyAdmission.verifyCatalog(tampered)) {
            XCTAssertEqual($0 as? Blocker, .invalidPolicy)
        }
        let wrongDigest = CatalogEnvelope(revision: envelope.revision, yaml: envelope.yaml,
                                          sha256: envelope.sha256 + "=", routing: envelope.routing)
        XCTAssertThrowsError(try PolicyAdmission.verifyCatalog(wrongDigest)) {
            XCTAssertEqual($0 as? Blocker, .invalidPolicy)
        }
    }

    func testWorkerPolicyDigestMatchesWithoutBypassingSignatureGate() throws {
        let envelope = try workerFixture().policy
        XCTAssertEqual(PolicyAdmission.digest(Data(envelope.json.utf8)), envelope.sha256)
        XCTAssertNotEqual(PolicyAdmission.digest(Data(envelope.json.dropLast().utf8)), envelope.sha256)
        XCTAssertThrowsError(try PolicyAdmission.verify(envelope, previousRevision: nil)) {
            XCTAssertEqual($0 as? Blocker, .invalidPolicy)
        }
        let badSignature = PolicyEnvelope(revision: envelope.revision, json: envelope.json, sha256: envelope.sha256,
                                          signature: Data(repeating: 0, count: 64).base64EncodedString())
        XCTAssertThrowsError(try PolicyAdmission.verify(badSignature, previousRevision: nil)) {
            XCTAssertEqual($0 as? Blocker, .invalidPolicy)
        }
    }

    func testMalformedHomeCredentialsDoNotBecomeAbsentRouting() {
        let data = Data(#"{"revision":1,"yaml":"x","sha256":"x","routing":{"homeSocks5":{"host":"example.com","port":1080,"username":"u"}}}"#.utf8)
        XCTAssertThrowsError(try JSONDecoder().decode(CatalogEnvelope.self, from: data))
    }

    func testAuthDecodesCurrentEnvelopeAndIgnoresEnrollmentSecrets() throws {
        let data = Data(#"{"auth":{"accessToken":"fixture-access","refreshToken":"fixture-refresh","user":{"id":"u","email":"example@example.invalid","deviceLimit":3},"device":{"id":"d","name":"phone","current":true},"enrollment":{"authKey":"never-retain-this"}}}"#.utf8)
        let session = try JSONDecoder().decode(AuthEnvelope.self, from: data).auth
        XCTAssertEqual(session.user.deviceLimit, 3)
        XCTAssertEqual(session.device?.current, true)
        XCTAssertFalse(String(decoding: try JSONEncoder().encode(session), as: UTF8.self).contains("never-retain-this"))
    }

    func testDuplicateDeviceNamesRemainDistinctForRemoval() {
        let first = CloudDevice(id: "00000000-0000-4000-8000-000000000001", name: "Tono for iOS", current: false, status: "active")
        let second = CloudDevice(id: "00000000-0000-4000-8000-000000000002", name: first.name, current: false, status: "active")
        XCTAssertNotEqual(first.removalLabel, second.removalLabel)
        XCTAssertEqual(first.removalLabel, "Remove Tono for iOS, device 00000000-0000-4000-8000-000000000001")
        XCTAssertEqual(second.removalLabel, "Remove Tono for iOS, device 00000000-0000-4000-8000-000000000002")
    }
}
