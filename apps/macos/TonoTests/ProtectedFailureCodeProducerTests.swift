import XCTest
@testable import Tono

/// The failure taxonomy exists so a failing machine can be classified. Seven of
/// its ten codes had no production construction site at all, so the support
/// bundle from an offline laptop, a stale helper, or a removed node all read
/// the same, and the handling branches written for those codes were dead.
///
/// Nothing in a build could notice that: an unconstructed enum case is not an
/// unused symbol, and the classifier's own `userMessage` switch keeps every
/// case referenced forever. These tests re-derive the producers from the
/// sources, which is the closest a test can get to a compile-time guard.
final class ProtectedFailureCodeProducerTests: XCTestCase {
    /// The test bundle does not carry the app sources, so walk up from this
    /// file to the checked-in production directory.
    private static func sourceRoot() -> URL? {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        for _ in 0..<4 {
            let candidate = dir.appendingPathComponent("Tono")
            let marker = candidate.appendingPathComponent("LiquidClashApp.swift")
            if FileManager.default.fileExists(atPath: marker.path) { return candidate }
            dir = dir.deletingLastPathComponent()
        }
        return nil
    }

    private static let sources: [(path: String, text: String)] = {
        guard let root = sourceRoot(),
              let enumerator = FileManager.default.enumerator(atPath: root.path)
        else { return [] }
        var found: [(path: String, text: String)] = []
        for case let path as String in enumerator where path.hasSuffix(".swift") {
            let url = root.appendingPathComponent(path)
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            found.append((path: path, text: text))
        }
        return found
    }()

    /// A line that constructs the code, as opposed to declaring it, rendering
    /// its message, or comparing against it. The enum's own declaration and its
    /// `userMessage` switch are what kept these cases looking alive.
    private func constructsCode(_ name: String, in line: String) -> Bool {
        guard line.contains(".\(name)") else { return false }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("//") { return false }
        if trimmed.hasPrefix("case .\(name):") { return false }
        if trimmed.hasPrefix("case .\(name),") { return false }
        if line.contains("==") || line.contains("!=") { return false }
        return true
    }

    /// Declared on both clients and constructed on neither. The post-lock
    /// classifier answers a failed controller probe over a live TUN with
    /// `.connected(controllerAdvisory:)`, which is not a failure, so there is
    /// nothing to build the code from. Listed rather than deleted because the
    /// Windows client declares the same case and the two taxonomies have to
    /// stay identical on the wire. Remove an entry the day it gains a producer.
    private static let taxonomyOnlyCodes: Set<ProtectedFailureCode> = [
        .coreControllerUnavailable,
    ]

    func testEveryFailureCodeHasAProductionProducer() throws {
        try XCTSkipIf(Self.sources.isEmpty, "production sources are not readable from here")
        for code in ProtectedFailureCode.allCases
        where !Self.taxonomyOnlyCodes.contains(code) {
            let name = String(describing: code)
            var producers: [String] = []
            for source in Self.sources {
                let lines = source.text.split(separator: "\n", omittingEmptySubsequences: false)
                for line in lines where constructsCode(name, in: String(line)) {
                    producers.append(source.path)
                }
            }
            XCTAssertFalse(
                producers.isEmpty,
                "\(code.rawValue) is never constructed in production; give it a producer or delete it"
            )
        }
    }

    /// The offline verdict is only as real as the argument that reaches it.
    /// `networkOffline` defaulted to false and no call site passed anything, so
    /// an offline Mac was diagnosed as an unreachable exit — which rotates the
    /// catalog on connect and fails over on a machine with no network at all.
    func testEveryClassifierCallSitePassesAPhysicalOfflineSignal() throws {
        try XCTSkipIf(Self.sources.isEmpty, "production sources are not readable from here")
        var callSites = 0
        for source in Self.sources {
            for arguments in callArguments(of: "ProtectedConnectivity.classifyPostLock", in: source.text) {
                callSites += 1
                XCTAssertTrue(
                    arguments.contains("networkOffline:"),
                    "\(source.path) classifies a post-lock failure without a physical-reachability signal"
                )
            }
        }
        XCTAssertGreaterThan(callSites, 0, "the classifier must still be called from production")
    }

    /// The argument text of every call to `function`, matched on parentheses so
    /// a multi-line call site is read whole.
    private func callArguments(of function: String, in source: String) -> [String] {
        let characters = Array(source)
        let needle = Array(function + "(")
        var found: [String] = []
        var index = 0
        while index + needle.count <= characters.count {
            guard Array(characters[index..<(index + needle.count)]) == needle else {
                index += 1
                continue
            }
            var depth = 0
            var cursor = index + needle.count - 1
            var body = ""
            while cursor < characters.count {
                let character = characters[cursor]
                if character == "(" {
                    depth += 1
                } else if character == ")" {
                    depth -= 1
                    if depth == 0 { break }
                }
                if depth >= 1, cursor > index + needle.count - 1 {
                    body.append(character)
                }
                cursor += 1
            }
            found.append(body)
            index = max(cursor, index + needle.count)
        }
        return found
    }
}
