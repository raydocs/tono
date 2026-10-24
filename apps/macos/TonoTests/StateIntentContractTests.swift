import Foundation
import XCTest

/// macOS reads the same state-intent fixture as the other clients. This target has no product
/// probe yet, so every macOS row must stay `todo` until one exists. The rule check and the
/// error-code scan still run here.
final class StateIntentContractTests: XCTestCase {
    func testFixtureMatchesTheRulesAndMacOSStaysTodoUntilAProbeExists() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.version, 1)
        XCTAssertEqual(fixture.accountContractHead, "429e23427")
        let decision = try String(contentsOf: repoRoot().appendingPathComponent(fixture.decision), encoding: .utf8)
        XCTAssertTrue(decision.contains("429e23427"))
        var covered = Set<Int>()
        XCTAssertEqual(fixture.scenarios.count, 18)
        for scenario in fixture.scenarios {
            covered.formUnion(scenario.rules)
            let row = try XCTUnwrap(scenario.platforms["macos"], scenario.id)
            XCTAssertEqual(row.enforcement, "todo", "macOS has no product probe for \(scenario.id)")
            XCTAssertFalse(row.note.isEmpty, scenario.id)
            let found = problems(scenario)
            XCTAssertTrue(found.isEmpty, found.joined(separator: "\n"))
            XCTAssertTrue(decision.contains(scenario.id), scenario.id)
        }
        XCTAssertEqual(covered, Set(1...7))
    }

    func testInternalCodesAreNotRenderedUnlessAllowlisted() throws {
        try scanErrorCodes(platform: "macos", repo: repoRoot())
    }
}
struct StateIntentFixture: Decodable {
    let version: Int
    let decision: String
    let accountContractPr: String
    let accountContractHead: String
    let scenarios: [StateIntentScenario]
}

struct StateIntentScenario: Decodable {
    let id: String
    let rules: [Int]
    let expect: StateIntentExpect
    let platforms: [String: StateIntentPlatform]
}

struct StateIntentExpect: Decodable {
    let display: String
    let notification: String
    let button: String
    let failureWritten: Bool
    let keepsSession: Bool
    let keepsVpnProfile: Bool
    let revokesNetworkGrant: Bool
    let autoConnect: Bool
    let silentNoOp: Bool
    let source: String
    let http: Int
    let code: String
    let deletesReports: Bool
    let lateStartApplied: Bool
    let connectBlocked: Bool
    let failureCleared: Bool
    let baselineUpdated: Bool
    let shownConnected: Bool
}

struct StateIntentPlatform: Decodable {
    let enforcement: String
    let owner: String
    let note: String
}

func loadFixture() throws -> StateIntentFixture {
    let data = try Data(contentsOf: repoRoot().appendingPathComponent("docs/contracts/state-intent-scenarios.json"))
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return try decoder.decode(StateIntentFixture.self, from: data)
}

func repoRoot() -> URL {
    var url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    let fm = FileManager.default
    while url.path != "/" {
        if fm.fileExists(atPath: url.appendingPathComponent("docs/contracts/state-intent-scenarios.json").path) {
            return url
        }
        url.deleteLastPathComponent()
    }
    fatalError("state-intent fixture not found from \(#filePath)")
}

func problems(_ scenario: StateIntentScenario) -> [String] {
    let e = scenario.expect
    let id = scenario.id
    var p: [String] = []
    func want(_ name: String, _ got: String, _ exp: String) {
        if got != exp { p.append("\(id) \(name)=\(got) want \(exp)") }
    }
    func flag(_ name: String, _ got: Bool, _ exp: Bool) {
        if got != exp { p.append("\(id) \(name)=\(got) want \(exp)") }
    }
    if e.silentNoOp { p.append("\(id) silent no-op") }
    switch id {
    case "user-disconnect":
        want("display", e.display, "off")
        want("notification", e.notification, "none")
        want("button", e.button, "connect")
        flag("failure", e.failureWritten, false)
        flag("session", e.keepsSession, true)
        flag("shown", e.shownConnected, false)
    case "system-revoke":
        want("display", e.display, "needs-permission")
        want("notification", e.notification, "permission-revoked")
        want("button", e.button, "open-settings")
        want("source", e.source, "system")
        flag("session", e.keepsSession, true)
        flag("shown", e.shownConnected, false)
    case "core-crash":
        want("display", e.display, "failed")
        want("notification", e.notification, "core-crashed")
        want("button", e.button, "retry")
        flag("failure", e.failureWritten, true)
        want("source", e.source, "core")
        flag("shown", e.shownConnected, false)
        flag("session", e.keepsSession, true)
    case "jetsam-or-process-killed":
        want("display", e.display, "failed")
        want("notification", e.notification, "process-killed")
        want("button", e.button, "retry")
        flag("failure", e.failureWritten, true)
        want("source", e.source, "core")
        flag("shown", e.shownConnected, false)
    case "network-lost":
        want("display", e.display, "failed")
        want("notification", e.notification, "network-lost")
        want("button", e.button, "retry")
        want("source", e.source, "network")
        flag("failure", e.failureWritten, true)
        flag("session", e.keepsSession, true)
    case "sign-out":
        want("display", e.display, "signed-out")
        want("notification", e.notification, "none")
        want("button", e.button, "sign-in")
        flag("failure", e.failureWritten, false)
        flag("session", e.keepsSession, false)
        flag("profile", e.keepsVpnProfile, false)
        flag("shown", e.shownConnected, false)
    case "plan-expired":
        want("display", e.display, "account-hold")
        want("notification", e.notification, "plan-expired")
        want("button", e.button, "renew")
        flag("http", e.http == 403, true)
        want("code", e.code, "PLAN_EXPIRED")
        flag("session", e.keepsSession, true)
        flag("profile", e.keepsVpnProfile, true)
        flag("grant", e.revokesNetworkGrant, true)
        flag("auto", e.autoConnect, false)
        flag("failure", e.failureWritten, false)
        want("source", e.source, "account")
    case "quota-exhausted":
        want("display", e.display, "account-hold")
        want("notification", e.notification, "quota-exhausted")
        want("button", e.button, "renew")
        flag("http", e.http == 403, true)
        want("code", e.code, "QUOTA_EXHAUSTED")
        flag("session", e.keepsSession, true)
        flag("profile", e.keepsVpnProfile, true)
        flag("grant", e.revokesNetworkGrant, true)
        flag("auto", e.autoConnect, false)
        flag("failure", e.failureWritten, false)
        want("source", e.source, "account")
    case "device-reauth-required":
        want("display", e.display, "reauth")
        want("notification", e.notification, "reauth-required")
        want("button", e.button, "verify-login")
        flag("http", e.http == 403, true)
        want("code", e.code, "DEVICE_REAUTH_REQUIRED")
        flag("session", e.keepsSession, true)
        flag("profile", e.keepsVpnProfile, true)
        flag("auto", e.autoConnect, false)
        flag("failure", e.failureWritten, false)
        want("source", e.source, "account")
    case "explicit-credential-revoke":
        want("display", e.display, "signed-out")
        want("notification", e.notification, "signed-out")
        want("button", e.button, "sign-in")
        flag("http", e.http == 401, true)
        want("code", e.code, "UNAUTHORIZED")
        flag("session", e.keepsSession, false)
        flag("profile", e.keepsVpnProfile, false)
        flag("failure", e.failureWritten, false)
        want("source", e.source, "account")
    case "rate-limited":
        want("display", e.display, "limited")
        want("notification", e.notification, "rate-limited")
        want("button", e.button, "retry")
        flag("http", e.http == 429, true)
        want("code", e.code, "RATE_LIMITED")
        flag("session", e.keepsSession, true)
        flag("reports", e.deletesReports, false)
        flag("profile", e.keepsVpnProfile, true)
    case "recovery-success":
        want("display", e.display, "connected")
        want("notification", e.notification, "recovered")
        want("button", e.button, "disconnect")
        flag("cleared", e.failureCleared, true)
        flag("failure", e.failureWritten, false)
        flag("shown", e.shownConnected, true)
        flag("session", e.keepsSession, true)
    case "retry-without-catalog":
        want("display", e.display, "catalog-missing")
        want("notification", e.notification, "catalog-missing")
        want("button", e.button, "retry")
        flag("session", e.keepsSession, true)
    case "cancel-then-late-start":
        want("display", e.display, "off")
        want("notification", e.notification, "none")
        want("button", e.button, "connect")
        flag("late", e.lateStartApplied, false)
        flag("shown", e.shownConnected, false)
        flag("failure", e.failureWritten, false)
    case "recheck-while-connected":
        want("display", e.display, "connected")
        want("notification", e.notification, "none")
        want("button", e.button, "disconnect")
        flag("shown", e.shownConnected, true)
        flag("failure", e.failureWritten, false)
    case "optional-rollback-failed":
        want("display", e.display, "failed")
        want("notification", e.notification, "rollback-failed")
        want("button", e.button, "retry")
        flag("shown", e.shownConnected, false)
        flag("baseline", e.baselineUpdated, true)
        flag("failure", e.failureWritten, true)
        want("source", e.source, "core")
    case "network-restored-update-retired":
        want("display", e.display, "ready")
        want("notification", e.notification, "none")
        want("button", e.button, "connect")
        flag("blocked", e.connectBlocked, false)
        flag("shown", e.shownConnected, false)
    case "network-restored-update-still-pending":
        want("display", e.display, "update-pending")
        want("notification", e.notification, "update-still-pending")
        want("button", e.button, "explain-blocked")
        flag("blocked", e.connectBlocked, true)
        flag("shown", e.shownConnected, false)
    default:
        p.append("unknown scenario \(id)")
    }
    return p
}

func scanErrorCodes(platform: String, repo: URL) throws {
    let data = try Data(contentsOf: repo.appendingPathComponent("docs/contracts/state-intent-error-code-allowlist.json"))
    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    guard let patterns = json?["patterns"] as? [String],
          let scan = json?["scan"] as? [String: [String]],
          let roots = scan[platform],
          let allowAll = json?["allow"] as? [[String: Any]] else {
        XCTFail("error-code allowlist is unreadable")
        return
    }
    let allow = allowAll.filter { $0["platform"] as? String == platform }
    let fm = FileManager.default
    let exts: Set<String> = ["kt", "swift", "tsx", "ts", "rs"]
    var matches: [(String, String)] = []
    for rel in roots {
        let root = repo.appendingPathComponent(rel)
        guard fm.fileExists(atPath: root.path) else {
            XCTFail("missing scan root \(rel)")
            continue
        }
        let rootIsDir = (try? root.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
        let files: [URL]
        if rootIsDir {
            guard let enumerator = fm.enumerator(at: root, includingPropertiesForKeys: nil) else {
                XCTFail("cannot list \(rel)")
                continue
            }
            files = enumerator.compactMap { $0 as? URL }
        } else {
            files = [root]
        }
        for file in files {
            if (try? file.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true { continue }
            if !exts.contains(file.pathExtension) { continue }
            let relPath = file.path.replacingOccurrences(of: repo.path + "/", with: "")
            if relPath.contains("/src/test/") || relPath.contains("/build/") { continue }
            let text = try String(contentsOf: file, encoding: .utf8)
            for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
                let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : String(raw)
                if patterns.contains(where: { line.contains($0) }) {
                    matches.append((relPath, line))
                }
            }
        }
    }
    for (path, line) in matches {
        let listed = allow.contains { entry in
            entry["file"] as? String == path && line.contains(entry["snippet"] as? String ?? "")
        }
        XCTAssertTrue(listed, "unlisted code render \(path): \(line)")
    }
    for entry in allow {
        let file = entry["file"] as? String ?? ""
        let snippet = entry["snippet"] as? String ?? ""
        let live = matches.contains { $0.0 == file && $0.1.contains(snippet) }
        XCTAssertTrue(live, "stale allowlist \(file) \(snippet)")
    }
}
