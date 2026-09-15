import XCTest
import CryptoKit
@testable import Tono

final class SingBoxConfigTests: XCTestCase {
    private typealias Snapshot = ConfigPipeline.SingBoxOfflineSnapshot
    private typealias Requirements = ConfigPipeline.SingBoxDerivedRequirements
    private let secret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="

    private func reference() throws -> [String: Any] {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent(
            "docs/reports/sing-box-evaluation/migration-m0/reference.json"))
        // Do not silently compare with a subsequently edited shared contract.
        XCTAssertEqual(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined(),
                       "f9977c06ccddf1001a77f0fe6ec13c5ffce4c053f8b721de908501fdf04ddbc0")
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    private func nodes() throws -> [ProxyNode] {
        let input = try XCTUnwrap(reference()["input"] as? [String: Any])
        return try XCTUnwrap(input["nodes"] as? [[String: Any]]).map { raw in
            var node = ProxyNode(name: try XCTUnwrap(raw["name"] as? String))
            node.type = .vless
            node.server = try XCTUnwrap(raw["server"] as? String)
            node.port = try XCTUnwrap(raw["port"] as? Int)
            node.uuid = raw["uuid"] as? String
            node.tls = true
            node.network = "tcp"
            node.sni = raw["servername"] as? String
            node.clientFingerprint = raw["client-fingerprint"] as? String
            node.flow = raw["flow"] as? String
            let reality = try XCTUnwrap(raw["reality-opts"] as? [String: Any])
            node.realityPublicKey = reality["public-key"] as? String
            node.realityShortId = reality["short-id"] as? String
            return node
        }
    }

    private func snapshot(_ object: [String: Any], identity: String = "synthetic-owner",
                          status: Snapshot.Status = .syntheticOfflineOnly) throws -> Snapshot {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        let digest = Data(SHA256.hash(data: data)).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        return Snapshot(rawJSON: data, identity: identity, revision: 17, digest: digest, status: status)
    }

    private func catalog(_ values: [ProxyNode]? = nil, routing: [String: Any] = [:]) throws -> Snapshot {
        let data = try JSONEncoder().encode(values ?? nodes())
        return try snapshot(["nodes": JSONSerialization.jsonObject(with: data), "routing": routing])
    }

    private func policy() throws -> [String: Any] {
        let input = try XCTUnwrap(reference()["input"] as? [String: Any])
        return try XCTUnwrap(input["policy_document"] as? [String: Any])
    }

    private func draft(catalog: Snapshot? = nil, policy: Snapshot? = nil,
                       plan: ConfigPipeline.ManagedDirectRuntimePolicy? = nil,
                       requirements: Requirements? = Requirements(nativeAppDirect: false),
                       mixedPort: Int = 29190, controllerPort: Int = 29191,
                       secret: String? = nil, selected: String = "Fixture Beta") throws -> ConfigPipeline.SingBoxRuntimeDraft {
        try ConfigPipeline.makeSingBoxOfflineDraft(
            catalog: catalog ?? self.catalog(), policy: policy ?? snapshot(self.policy()),
            selected: selected, directPlan: plan, derivedRequirements: requirements,
            platform: "macos-arm64", controllerPort: controllerPort, mixedPort: mixedPort,
            controllerSecret: secret ?? self.secret, generation: 73
        )
    }

    func testAsymmetricReferenceAndDraftOnlyReceipt() throws {
        let value = try draft()
        var expected = try XCTUnwrap(reference()["windows_runtime"] as? [String: Any])
        var inbounds = try XCTUnwrap(expected["inbounds"] as? [[String: Any]])
        inbounds[0]["interface_name"] = "utun199"
        expected["inbounds"] = inbounds
        let actual = try XCTUnwrap(JSONSerialization.jsonObject(with: value.runtimeJSON) as? NSDictionary)
        XCTAssertEqual(actual, expected as NSDictionary)
        XCTAssertEqual(value.dialEndpoints, [.init(host: "9.9.9.9", port: 8443, transport: "tcp")])
        XCTAssertEqual(value.runtimeSHA256, SHA256.hash(data: value.runtimeJSON).map { String(format: "%02x", $0) }.joined())
        XCTAssertEqual(value.generation, 73)
        XCTAssertEqual(value.catalogSnapshot.revision, 17)
        XCTAssertEqual(value.lifecycle, .syntheticDraftOnly)
        XCTAssertEqual(value.selectedIndex, 1)
        XCTAssertFalse(value.runtimeJSON.starts(with: [0xEF, 0xBB, 0xBF]))
    }

    func testDiagnosticReflectionDoesNotExposeCredentialsOrNodes() throws {
        let value = try draft()
        var diagnostics = "\(value) \(String(reflecting: value)) \(value.catalogSnapshot)"
        dump(value, to: &diagnostics)
        XCTAssertFalse(diagnostics.contains(secret))
        XCTAssertFalse(diagnostics.contains("11111111-1111"))
        XCTAssertFalse(diagnostics.contains("Fixture Beta"))
        XCTAssertFalse(diagnostics.contains("9.9.9.9"))
        XCTAssertFalse(diagnostics.contains("3p7bfXt9"))
    }

    func testRawPolicyCannotBeFilteredIntoNoRequirements() throws {
        var raw = try policy()
        raw["domains"] = [["host": "invalid requirement", "ports": [443]]]
        XCTAssertThrowsError(try draft(policy: snapshot(raw))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedPolicy)
        }
        raw = try policy()
        raw["futureRouting"] = []
        XCTAssertThrowsError(try draft(policy: snapshot(raw))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedPolicy)
        }
        raw = try policy()
        raw["version"] = 4
        XCTAssertThrowsError(try draft(policy: snapshot(raw))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedPolicy)
        }
    }

    func testNilAndEmptyDirectPlanDoNotEraseProductDefaults() throws {
        XCTAssertThrowsError(try draft(requirements: nil))
        XCTAssertThrowsError(try draft(requirements: Requirements()))
        let empty = ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0", domainPins: [], mediaEndpoints: [])
        XCTAssertTrue(empty.isEmpty)
        XCTAssertTrue(empty.nativeAppDirect)
        XCTAssertThrowsError(try draft(plan: empty)) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedPolicy)
        }
        var unknown = Requirements(nativeAppDirect: false)
        unknown.additionalCapabilities = ["udp"]
        XCTAssertThrowsError(try draft(requirements: unknown))
    }

    func testPresentInvalidHomeRoutingAndDerivedHomeAreRejected() throws {
        XCTAssertThrowsError(try draft(catalog: catalog(routing: ["homeProxy": ""]))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedHomeRoute)
        }
        XCTAssertThrowsError(try draft(catalog: catalog(routing: ["homeSocks5": NSNull()]))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedHomeRoute)
        }
        var requirements = Requirements(nativeAppDirect: false)
        requirements.homeRoute = true
        XCTAssertThrowsError(try draft(requirements: requirements))
    }

    func testUnselectedHy2IsRejectedWithoutPinConversion() throws {
        var values = try nodes()
        values[0].type = .hysteria2
        values[0].tlsFingerprint = String(repeating: "ab", count: 32)
        XCTAssertThrowsError(try draft(catalog: catalog(values))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedTransport)
            XCTAssertEqual(String(describing: $0), "TONO_SINGBOX_UNSUPPORTED_TRANSPORT")
        }
    }

    func testAdmissionAndExplicitFingerprintCannotBeBypassed() throws {
        var values = try nodes()
        values[0].clientFingerprint = nil
        XCTAssertThrowsError(try draft(catalog: catalog(values))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .unsupportedFingerprint)
        }
        values = try nodes()
        values[0].server = "127.0.0.1"
        XCTAssertThrowsError(try draft(catalog: catalog(values))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .invalidNode)
        }
        values = try nodes()
        values[0].name = "Tono-DNS"
        XCTAssertThrowsError(try draft(catalog: catalog(values)))
        XCTAssertThrowsError(try draft(selected: "not-in-catalog"))
    }

    func testUntrustedSnapshotDoesNotProduceDraft() throws {
        XCTAssertThrowsError(try draft(policy: snapshot(policy(), status: .expired))) {
            XCTAssertEqual($0 as? ConfigPipeline.SingBoxError, .untrustedSnapshot)
        }
        XCTAssertThrowsError(try draft(policy: snapshot(policy(), identity: "other-owner")))
        let good = try snapshot(policy())
        let bad = Snapshot(rawJSON: good.rawJSON, identity: good.identity, revision: 17,
                           digest: "mismatched", status: .syntheticOfflineOnly)
        XCTAssertThrowsError(try draft(policy: bad))
    }

    func testMixedDisabledAndControlRefusals() throws {
        let value = try draft(mixedPort: 0)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: value.runtimeJSON) as? [String: Any])
        XCTAssertEqual((object["inbounds"] as? [Any])?.count, 2)
        XCTAssertThrowsError(try draft(mixedPort: 29191))
        XCTAssertThrowsError(try draft(controllerPort: 53))
        XCTAssertThrowsError(try draft(secret: String(secret.dropLast())))
    }

    func testExclusionsAreNumericSortedAndDeduplicatedWithoutWideningPermits() throws {
        var values = try nodes()
        values[0].server = "11.0.0.1"
        values[1].server = "2.0.0.1"
        var third = values[0]
        third.name = "Third"
        values.append(third)
        let value = try draft(catalog: catalog(values))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: value.runtimeJSON) as? [String: Any])
        let tun = try XCTUnwrap((object["inbounds"] as? [[String: Any]])?.first)
        XCTAssertEqual(tun["route_exclude_address"] as? [String], ["2.0.0.1/32", "11.0.0.1/32"])
        XCTAssertEqual(value.dialEndpoints, [.init(host: "2.0.0.1", port: 8443, transport: "tcp")])
    }
}
