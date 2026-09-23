import XCTest
@testable import Tono

final class UpdateContractV1Tests: XCTestCase {
    private typealias Contract = UpdateContractV1

    private func fixture(_ name: String) throws -> Data {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try Data(contentsOf: root.appendingPathComponent(
            "tooling/scripts/tests/fixtures/update-protocol-v1/\(name)"))
    }

    private struct Fixtures: Decodable {
        let fixtureVersion: Int
        let manifestSha256: String
        let rejectedDocuments: [RejectedDocument]
        let replays: [Replay]
    }
    private struct RejectedDocument: Decodable {
        let name: String
        let document: String
        let find: String
        let replace: String
    }
    private struct Replay: Decodable {
        let name: String
        let receipt: String
        let steps: [Step]
    }
    private struct Step: Decodable {
        let name: String
        let event: String
        let generation: UInt64
        let nowUnix: UInt64
        let owner: String?
        let attemptId: String?
        let installedLocationSha256: String?
        let targetId: Contract.TargetId?
        let protection: Contract.Protection?
        let artifactSha256: String?
        let wrongPrivilegedComponent: Bool?
        let error: String?
        let phase: Contract.Phase?
        let successorGeneration: UInt64?
        let blockedReason: Contract.BlockReason?
    }

    // Executes the same wire bytes/refusal/success steps as the Rust integration
    // test. Does not mock or reimplement the production decision function.
    func testSharedWireAndOwnershipContract() throws {
        let fixtures = try JSONDecoder().decode(Fixtures.self, from: fixture("conformance.json"))
        XCTAssertEqual(fixtures.fixtureVersion, 1)
        XCTAssertEqual(fixtures.rejectedDocuments.count, 15, "missing parser cases")
        XCTAssertEqual(fixtures.replays.count, 4, "missing owner replays")
        XCTAssertEqual(fixtures.replays.reduce(0) { $0 + $1.steps.count }, 33)
        let bytes = try fixture("manifest.json")
        let manifest = try Contract.ReleaseManifest.decode(bytes)
        XCTAssertEqual(try Contract.canonical(manifest), bytes)
        XCTAssertEqual(try manifest.sha256(), fixtures.manifestSha256)
        XCTAssertThrowsError(try Contract.ReleaseManifest.decode(Data(repeating: 32, count: 16_385))) {
            XCTAssertEqual($0 as? Contract.ContractError, .document)
        }
        for item in fixtures.rejectedDocuments {
            let input = try XCTUnwrap(String(data: fixture(item.document), encoding: .utf8))
            XCTAssertTrue(input.contains(item.find), "ineffective mutation: \(item.name)")
            let changed = Data(input.replacingOccurrences(of: item.find, with: item.replace).utf8)
            XCTAssertThrowsError(try {
                if item.document == "manifest.json" {
                    _ = try Contract.ReleaseManifest.decode(changed)
                } else {
                    _ = try Contract.Receipt.decode(changed, manifest: manifest)
                }
            }(), item.name) {
                XCTAssertEqual($0 as? Contract.ContractError, .document, item.name)
            }
        }
        for replay in fixtures.replays {
            let bytes = try fixture(replay.receipt)
            var receipt = try Contract.Receipt.decode(bytes, manifest: manifest)
            XCTAssertEqual(try Contract.canonical(receipt), bytes)
            let target = try manifest.target(receipt.targetId)
            for step in replay.steps {
                let before = try Contract.canonical(receipt)
                let components = Contract.Components(
                    appSha256: target.components.appSha256, coreSha256: target.components.coreSha256,
                    privilegedSha256: step.wrongPrivilegedComponent == true
                        ? String(repeating: "0", count: 64) : target.components.privilegedSha256)
                let observation: Contract.Observation
                switch step.event {
                case "prepare": observation = .preparationVerified(
                    artifactSha256: step.artifactSha256 ?? target.artifactSha256,
                    protection: try XCTUnwrap(step.protection))
                case "installed": observation = .installedIdentityVerified(components: components)
                case "recover": observation = .recoveryVerified(components: components, protection: try XCTUnwrap(step.protection))
                case "commit": observation = .commitVerified(components: components, protection: try XCTUnwrap(step.protection))
                case "continuation": observation = .applicationContinuationRequested
                case "block": observation = .block(try XCTUnwrap(step.blockedReason))
                default: XCTFail("unknown fixture event \(step.event)"); return
                }
                let context = Contract.Context(
                    attemptId: step.attemptId ?? receipt.attemptId, owner: step.owner ?? receipt.owner,
                    installedLocationSha256: step.installedLocationSha256 ?? receipt.installedLocationSha256,
                    targetId: step.targetId ?? receipt.targetId, generation: step.generation, nowUnix: step.nowUnix)
                let label = "\(replay.name) / \(step.name)"
                let result = Result { try receipt.propose(manifest: manifest, context: context, observation: observation) }
                XCTAssertEqual(try Contract.canonical(receipt), before, "a proposal must not mutate the original")
                if let error = step.error {
                    XCTAssertNil(step.phase, "ambiguous expectation: \(label)")
                    XCTAssertThrowsError(try result.get(), label) {
                        XCTAssertEqual(($0 as? Contract.ContractError)?.rawValue, error, label)
                    }
                } else {
                    let next = try result.get()
                    XCTAssertEqual(next.phase, step.phase, label)
                    XCTAssertEqual(next.successorGeneration, step.successorGeneration, label)
                    XCTAssertEqual(next.blockedReason, step.blockedReason, label)
                    XCTAssertEqual(next.updatedAtUnix, step.nowUnix, label)
                    // Model serialization/re-entry, not a durable write or crash.
                    receipt = try Contract.Receipt.decode(Contract.canonical(next), manifest: manifest)
                }
            }
        }
        if let output = ProcessInfo.processInfo.environment["TEST_RUNNER_TONO_EMIT_UPDATE_CONTRACT"]
            ?? ProcessInfo.processInfo.environment["TONO_EMIT_UPDATE_CONTRACT"] {
            try Data((fixtures.manifestSha256 + "\n").utf8).write(to: URL(fileURLWithPath: output), options: .atomic)
        }
    }
}
