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

    /// A managed hy2 block read by the production catalog parser, so the
    /// published key name is part of what the test pins.
    private func catalogHY2(name: String, server: String, spki: String) throws -> ProxyNode {
        let yaml = """
        proxies:
          - name: \(name)
            type: hysteria2
            server: \(server)
            port: 443
            password: 11111111-1111-4111-8111-111111111111
            sni: exit.example.com
            fingerprint: \(String(repeating: "ab", count: 32))
            certificate-public-key-sha256: "\(spki)"
        """
        return try XCTUnwrap(ConfigParser.parseSubscription(yaml).first)
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

    func testHY2WithPublishedSPKIPinGetsPinnedSingBoxOutbound() throws {
        let spki = Data(repeating: 0xab, count: 32).base64EncodedString()
        var values = try nodes()
        let hy2 = try catalogHY2(name: "Fixture Alpha · hy2", server: values[0].server, spki: spki)
        XCTAssertNil(ConfigPipeline.singBoxUnavailableReason(hy2))
        values.append(hy2)
        let overlay = ConfigPipeline.OverlayConfig(mixedPort: 29190,
            externalController: "127.0.0.1:29191", secret: secret, tunEnabled: true,
            selectedNodeName: hy2.name)
        let result = try ConfigPipeline.buildSingBoxRuntime(overlay: overlay, nodes: values, directPlan: nil)
        XCTAssertEqual(result.unavailableNodes, [:])
        XCTAssertEqual(result.dialEndpoints, [.init(host: values[0].server, port: 443, transport: "udp")])
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: result.runtimeJSON) as? [String: Any])
        let outbounds = try XCTUnwrap(json["outbounds"] as? [[String: Any]])
        let outbound = try XCTUnwrap(outbounds.first { $0["tag"] as? String == hy2.name })
        XCTAssertEqual(outbound["tls"] as? NSDictionary, [
            "enabled": true, "server_name": "exit.example.com", "certificate_public_key_sha256": [spki],
        ] as NSDictionary)
    }

    func testProductRuntimePreservesHomeDirectAndRejectsHY2WithoutSPKIPin() throws {
        var overlay = ConfigPipeline.OverlayConfig(mixedPort: 29190,
            externalController: "127.0.0.1:29191", secret: secret, tunEnabled: true,
            selectedNodeName: "Fixture Beta", claudeHomeNodeName: "Fixture Alpha")
        let plan = ConfigPipeline.ManagedDirectRuntimePolicy(physicalInterface: "en0",
            domainPins: [], webDomainPins: [.init(host: "www.qq.com", addresses: ["101.32.104.4"], ports: [443])],
            mediaEndpoints: [], directResolverHosts: ["www.qq.com"], trusted: true)
        var values = try nodes()
        var hy2 = values[0]
        hy2.name = "Fixture Alpha · hy2"
        hy2.type = .hysteria2
        hy2.network = "udp"
        hy2.password = "11111111-1111-4111-8111-111111111111"
        hy2.tlsFingerprint = String(repeating: "ab", count: 32)
        values.append(hy2)
        // Pinned sibling: its outbound reaches the bytes the fixed core checks below.
        values.append(try catalogHY2(name: "Fixture Beta · hy2", server: values[1].server,
                                     spki: Data(repeating: 0xcd, count: 32).base64EncodedString()))
        // Hosted CI has no reviewed app installed; supply the discovered path.
        ConfigPipeline.managedDirectBundlePathsOverride = ["/Applications/WeChat.app/"]
        defer { ConfigPipeline.managedDirectBundlePathsOverride = nil }
        let result = try ConfigPipeline.buildSingBoxRuntime(overlay: overlay, nodes: values, directPlan: plan)
        XCTAssertEqual(result.unavailableNodes, [hy2.name: "TONO_SINGBOX_HY2_DER_PIN_UNSUPPORTED"])
        XCTAssertEqual(Set(result.dialEndpoints.map(\.host)), Set([values[0].server, values[1].server]))
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: result.runtimeJSON) as? [String: Any])
        let inbounds = try XCTUnwrap(json["inbounds"] as? [[String: Any]])
        XCTAssertNil(inbounds[0]["stack"])
        XCTAssertEqual(inbounds[0]["dns_mode"] as? String, "disabled")
        let outbounds = try XCTUnwrap(json["outbounds"] as? [[String: Any]])
        XCTAssertFalse(outbounds.contains { $0["tag"] as? String == hy2.name })
        XCTAssertFalse(outbounds.contains { $0["type"] as? String == "urltest" })
        let home = try XCTUnwrap(outbounds.first { $0["tag"] as? String == "Tono-Claude-Home" })
        XCTAssertEqual(home["outbounds"] as? [String], ["Fixture Alpha"])
        let route = try XCTUnwrap(json["route"] as? [String: Any])
        let rules = try XCTUnwrap(route["rules"] as? [[String: Any]])
        let homeRule = try XCTUnwrap(rules.firstIndex { $0["outbound"] as? String == "Tono-Claude-Home" })
        let directRule = try XCTUnwrap(rules.firstIndex { $0["outbound"] as? String == "Tono-China-App" })
        XCTAssertLessThan(homeRule, directRule)
        XCTAssertTrue(rules.contains { $0["mode"] as? String == "and" })
        XCTAssertTrue(result.directEndpoints.contains(.init(address: "223.5.5.5", port: 443, transport: "tcp")))
        overlay.selectedNodeName = hy2.name
        XCTAssertThrowsError(try ConfigPipeline.buildSingBoxRuntime(overlay: overlay, nodes: values, directPlan: plan))
        // Hosted CI checks these actual Swift-emitted bytes with the fixed core.
        if let path = ProcessInfo.processInfo.environment["TEST_RUNNER_TONO_EMIT_SINGBOX"]
            ?? ProcessInfo.processInfo.environment["TONO_EMIT_SINGBOX"] {
            try result.runtimeJSON.write(to: URL(fileURLWithPath: path))
        }
    }

    func testDirectRoutesNeverMatchOnProcessName() throws {
        // A plan opens root's web ports in PF, so any rule that sends a
        // basename to a direct outbound lets a renamed process leave untunneled.
        let overlay = ConfigPipeline.OverlayConfig(mixedPort: 29190,
            externalController: "127.0.0.1:29191", secret: secret, tunEnabled: true,
            selectedNodeName: "Fixture Beta")
        let plan = ConfigPipeline.ManagedDirectRuntimePolicy(physicalInterface: "en0",
            domainPins: [], webDomainPins: [.init(host: "www.qq.com", addresses: ["101.32.104.4"], ports: [443])],
            mediaEndpoints: [], directResolverHosts: ["www.qq.com"], trusted: true)
        let result = try ConfigPipeline.buildSingBoxRuntime(overlay: overlay, nodes: nodes(), directPlan: plan)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: result.runtimeJSON) as? [String: Any])
        let rules = try XCTUnwrap((json["route"] as? [String: Any])?["rules"] as? [[String: Any]])
        let direct: Set<String> = ["DIRECT", ConfigPipeline.appDirectGroupName, ConfigPipeline.webDirectGroupName]
        let directRules = rules.filter { direct.contains($0["outbound"] as? String ?? "") }
        XCTAssertFalse(directRules.contains { $0["process_name"] != nil })
        XCTAssertFalse(directRules.contains { $0["process_path"] != nil },
                       "a process identity alone cannot authorize public DIRECT")
    }

    func testContinuityLocalBypassDoesNotForcePublicAppleTrafficDirectWithoutPolicy() throws {
        let overlay = ConfigPipeline.OverlayConfig(mixedPort: 29190,
            externalController: "127.0.0.1:29191", secret: secret, tunEnabled: true,
            selectedNodeName: "Fixture Beta")
        let result = try ConfigPipeline.buildSingBoxRuntime(overlay: overlay, nodes: nodes(), directPlan: nil)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: result.runtimeJSON) as? [String: Any])
        let route = try XCTUnwrap(json["route"] as? [String: Any])
        let rules = try XCTUnwrap(route["rules"] as? [[String: Any]])
        let localIndex = try XCTUnwrap(rules.firstIndex {
            $0["outbound"] as? String == "DIRECT" && $0["ip_cidr"] != nil
        })
        let local = Set(try XCTUnwrap(rules[localIndex]["ip_cidr"] as? [String]))
        XCTAssertTrue(Set(["169.254.0.0/16", "fe80::/10", "fc00::/7", "224.0.0.0/4", "ff00::/8"])
            .isSubset(of: local), "AWDL/link-local and multicast remain direct")
        let ipv6RejectIndex = try XCTUnwrap(rules.firstIndex { $0["ip_version"] as? Int == 6 })
        XCTAssertLessThan(localIndex, ipv6RejectIndex, "local IPv6 must bypass the public IPv6 reject")
        XCTAssertFalse(rules.contains {
            $0["outbound"] as? String == "DIRECT" && $0["process_path"] != nil
                && $0["ip_cidr"] == nil
        }, "Apple public TCP traffic must not bypass a healthy tunnel without matching PF authorization")
        XCTAssertEqual(route["final"] as? String, ConfigPipeline.exitGroupName)
    }
}
