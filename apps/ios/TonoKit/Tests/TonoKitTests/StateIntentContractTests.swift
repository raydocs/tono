import XCTest
@testable import TonoKit

/// The shared state-intent table. The fixture is the contract; these checks are the rules.
/// A product probe that still disagrees is `expected-failure`: it fails once the product matches,
/// until that row's enforcement flips to `enabled`. `todo` is not a pass.
final class StateIntentContractTests: XCTestCase {
    func testFixtureMatchesTheRulesAndTheDecision() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.version, 1)
        XCTAssertEqual(fixture.accountContractHead, "429e23427")
        XCTAssertEqual(fixture.accountContractPr, "https://github.com/raydocs/tono/pull/1738")
        let decision = try String(contentsOf: repoRoot().appendingPathComponent(fixture.decision), encoding: .utf8)
        XCTAssertTrue(decision.contains("134-2026-10-24-state-intent-rule"))
        XCTAssertTrue(decision.contains("429e23427"))
        XCTAssertTrue(decision.contains("LibboxStub"))
        var covered = Set<Int>()
        var ids = Set<String>()
        XCTAssertEqual(fixture.scenarios.count, 18)
        for scenario in fixture.scenarios {
            XCTAssertTrue(ids.insert(scenario.id).inserted, scenario.id)
            covered.formUnion(scenario.rules)
            XCTAssertEqual(scenario.platforms.count, 4, scenario.id)
            for name in ["ios", "android", "macos", "windows"] {
                let row = try XCTUnwrap(scenario.platforms[name], scenario.id)
                XCTAssertTrue(["enabled", "expected-failure", "todo"].contains(row.enforcement), scenario.id)
                XCTAssertFalse(row.note.isEmpty, scenario.id)
                XCTAssertFalse(row.owner.isEmpty, scenario.id)
            }
            let found = problems(scenario)
            XCTAssertTrue(found.isEmpty, found.joined(separator: "\n"))
            XCTAssertTrue(decision.contains(scenario.id), scenario.id)
        }
        XCTAssertEqual(covered, Set(1...7))
    }

    func testProductProbesAgreeOrAreMarked() throws {
        // A user stop is not a failure at the classifier. The display gap is the shared-status probe below.
        XCTAssertEqual(
            TunnelStop.classify(before: .connected, userStarting: false, userStopping: true, recordedFailure: "CORE_STOPPED"),
            .expected)
        XCTAssertFalse(AccountErrors.isSessionEnded(APIError(status: 403, code: "PLAN_EXPIRED", message: "")))
        XCTAssertFalse(AccountErrors.isSessionEnded(APIError(status: 403, code: "QUOTA_EXHAUSTED", message: "")))
        XCTAssertFalse(AccountErrors.isSessionEnded(APIError(status: 403, code: "DEVICE_REAUTH_REQUIRED", message: "")))
        XCTAssertFalse(AccountErrors.isSessionEnded(APIError(status: 429, code: "RATE_LIMITED", message: "")))
        XCTAssertTrue(AccountErrors.isSessionEnded(APIError(status: 401, code: "UNAUTHORIZED", message: "")))
        XCTAssertTrue(AccountErrors.isSessionEnded(APIError(status: 401, code: "INVALID_REFRESH_TOKEN", message: "")))

        let fixture = try loadFixture()
        for scenario in fixture.scenarios {
            let row = try XCTUnwrap(scenario.platforms["ios"])
            if let actual = observed(scenario.id) {
                XCTAssertNotEqual(row.enforcement, "todo", scenario.id)
                assertProbe(row.enforcement, actual: actual, expected: scenario.expect.display, id: scenario.id)
            } else {
                XCTAssertEqual(row.enforcement, "todo", scenario.id)
            }
        }
    }

    func testInternalCodesAreNotRenderedUnlessAllowlisted() throws {
        try scanErrorCodes(platform: "ios", repo: repoRoot())
    }

    private func assertProbe(_ enforcement: String, actual: String, expected: String, id: String) {
        switch enforcement {
        case "enabled":
            XCTAssertEqual(actual, expected, id)
        case "expected-failure":
            XCTAssertNotEqual(actual, expected, "\(id) now matches the contract (\(actual)); set ios enforcement to enabled")
        default:
            XCTFail("no probe path for \(enforcement) \(id)")
        }
    }

    private func observed(_ id: String) -> String? {
        switch id {
        case "user-disconnect":
            return word(reading(note: .off, failure: "CORE_STOPPED"))
        case "sign-out":
            return word(reading(note: .signedOut, failure: nil))
        case "core-crash":
            return word(reading(note: nil, failure: "CORE_STOPPED"))
        case "jetsam-or-process-killed":
            let stop = TunnelStop.classify(before: .connected, userStarting: false, userStopping: false, recordedFailure: nil)
            if case .stoppedBySystem = stop { return "failed" }
            return "off"
        case "recovery-success":
            // Up, stopped by the system (failure on record), back up on its own: the old failure is gone.
            var ledger = TunnelIntentLedger()
            ledger.starting()
            ledger.tunnel(.connected, before: .connecting, recordedFailure: nil)
            ledger.tunnel(.disconnected, before: .connected, recordedFailure: "CORE_STOPPED")
            ledger.tunnel(.connecting, before: .disconnected, recordedFailure: nil)
            ledger.tunnel(.connected, before: .connecting, recordedFailure: nil)
            guard ledger.failure == nil else { return "failed" }
            return phaseWord(ConnectionState.derive(ConnectionFacts(
                signedIn: true, tunnel: .connected, cloudProbe: ExitProbe(state: .ok), homeProbe: ExitProbe(state: .ok),
                failure: ledger.failure, routing: .graph(RouteSettings(mode: .threeTier, node: "tokyo")))).phase)
        case "cancel-then-late-start":
            // Cancel after the start was handed to the system, before NE reported it; the cancelled
            // start then fails on its way down.
            var ledger = TunnelIntentLedger()
            ledger.userWantsOn()
            ledger.starting()
            ledger.userStops(tunnel: .disconnected)
            ledger.tunnel(.connecting, before: .disconnected, recordedFailure: nil)
            ledger.tunnel(.disconnected, before: .connecting, recordedFailure: "CORE_START")
            return phaseWord(ConnectionState.derive(ConnectionFacts(signedIn: true, tunnel: .disconnected, failure: ledger.failure)).phase)
        case "plan-expired":
            return accountDisplay(status: 403, code: "PLAN_EXPIRED")
        case "quota-exhausted":
            return accountDisplay(status: 403, code: "QUOTA_EXHAUSTED")
        case "device-reauth-required":
            return accountDisplay(status: 403, code: "DEVICE_REAUTH_REQUIRED")
        case "explicit-credential-revoke":
            return accountDisplay(status: 401, code: "UNAUTHORIZED")
        case "rate-limited":
            return accountDisplay(status: 429, code: "RATE_LIMITED")
        case "recheck-while-connected":
            let derived = ConnectionState.derive(ConnectionFacts(
                signedIn: true, tunnel: .connected,
                cloudProbe: ExitProbe(state: .checking), homeProbe: ExitProbe(state: .ok),
                routing: .graph(RouteSettings(mode: .threeTier, node: "tokyo"))))
            return derived.phase == .connected || derived.phase == .degraded ? "connected" : "connecting"
        default:
            return nil
        }
    }

    private func accountDisplay(status: Int, code: String) -> String {
        if AccountErrors.isSessionEnded(APIError(status: status, code: code, message: "")) { return "signed-out" }
        let derived = ConnectionState.derive(ConnectionFacts(signedIn: true, tunnel: .disconnected, failure: code))
        if derived.phase == .failed, code == "RATE_LIMITED" { return "limited" }
        if derived.phase == .failed { return "failed" }
        if code == "PLAN_EXPIRED" || code == "QUOTA_EXHAUSTED" { return "account-hold" }
        if code == "DEVICE_REAUTH_REQUIRED" { return "reauth" }
        return "other"
    }

    /// App note at t0, tunnel beat after it, same start opened earlier. Mirrors a late core report.
    private func reading(note: AppNote.State?, failure: String?) -> StatusSnapshot.State? {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let tunnel = TunnelReport(session: "s1", opened: t0.addingTimeInterval(-30), generation: 1,
                                  running: false, routing: nil, since: nil, failure: failure,
                                  beatAt: t0.addingTimeInterval(2), catalog: nil)
        let app = note.map { AppNote(state: $0, writtenAt: t0) }
        return SharedStatus(tunnel: tunnel, app: app).reading(now: t0.addingTimeInterval(3)).snapshot?.state
    }

    private func phaseWord(_ phase: Phase) -> String {
        switch phase {
        case .idle, .needsPermission: return "off"
        case .failed: return "failed"
        case .signedOut: return "signed-out"
        case .connected, .degraded: return "connected"
        case .preparing, .connecting, .disconnecting: return "connecting"
        }
    }

    private func word(_ state: StatusSnapshot.State?) -> String {
        switch state {
        case .off: return "off"
        case .failed: return "failed"
        case .signedOut: return "signed-out"
        case .on, .degraded: return "connected"
        case .connecting: return "connecting"
        case nil: return "unavailable"
        }
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
