import XCTest
@testable import Tono

/// Exercise the helpers through the compiled app module, not concatenated source
/// snippets. This also guards the cross-file visibility needed by AppState.
final class AppStateSupportTests: XCTestCase {
    private func provider(_ name: String, behavior: String = "domain") -> APIRuleProvider {
        APIRuleProvider(
            name: name, type: "http", behavior: behavior, ruleCount: 0,
            updatedAt: nil, vehicleType: nil
        )
    }

    func testProviderRulesAreOrderedAndUseTheInlineTarget() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try "payload:\n  - '+.example.com'\n".write(
            to: directory.appendingPathComponent("a.yaml"), atomically: true, encoding: .utf8
        )
        try "payload:\n  - DOMAIN-SUFFIX,example.org\n".write(
            to: directory.appendingPathComponent("z.yaml"), atomically: true, encoding: .utf8
        )

        let rules = await ProviderRuleLoader().load(
            providers: ["z": provider("z", behavior: "classical"), "a": provider("a")],
            inlineRules: [APIRule(type: "RULE-SET", payload: "a", proxy: "DIRECT")],
            directory: directory
        )

        XCTAssertEqual(rules.map(\.type), ["DOMAIN", "DOMAIN-SUFFIX"])
        XCTAssertEqual(rules.map(\.payload), ["example.com", "example.org"])
        XCTAssertEqual(rules.map(\.proxy), ["DIRECT", "z"])
    }

    func testProviderLoaderRejectsTraversalAndSymlinks() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let providersDirectory = directory.appendingPathComponent("providers", isDirectory: true)
        try FileManager.default.createDirectory(at: providersDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let outside = directory.appendingPathComponent("outside.yaml")
        try "payload:\n  - example.com\n".write(to: outside, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(
            at: providersDirectory.appendingPathComponent("linked.yaml"),
            withDestinationURL: outside
        )

        let rules = await ProviderRuleLoader().load(
            providers: ["../outside": provider("../outside"), "linked": provider("linked")],
            inlineRules: [], directory: providersDirectory
        )
        XCTAssertTrue(rules.isEmpty)
    }

    func testCancellationBeforeRegistrationRejectsProcess() {
        let box = CancellableProcessBox()
        box.cancel()
        XCTAssertFalse(box.register(Process()))
    }

    func testClearingOneProcessDoesNotCancelFutureRegistrations() {
        let box = CancellableProcessBox()
        let process = Process()
        XCTAssertTrue(box.register(process))
        box.clear(process)
        XCTAssertTrue(box.register(Process()))
        box.cancel()
        XCTAssertFalse(box.register(Process()))
    }
}
