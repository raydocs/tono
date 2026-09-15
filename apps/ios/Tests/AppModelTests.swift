import XCTest
@testable import Tono

final class AppModelTests: XCTestCase {
    @MainActor func testComprehensiveToOffPersistsAndClearsAtModelBoundary() throws {
        let name = "TonoTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let model = AppModel(preferences: defaults, distribution: "testflight")
        XCTAssertEqual(model.diagnosticPolicy, .comprehensive)
        for _ in 0..<129 {
            model.diagnostics.append(.init(kind: .stateChanged, state: .connecting), policy: model.diagnosticPolicy)
        }
        XCTAssertEqual(model.diagnostics.dropped, 1)
        model.setDiagnosticPolicy(.off)
        XCTAssertEqual(model.diagnosticPolicy, .off)
        XCTAssertTrue(model.diagnostics.events.isEmpty)
        XCTAssertEqual(model.diagnostics.dropped, 0)
        XCTAssertEqual(defaults.string(forKey: "diagnosticPolicy"), "off")
        let restored = AppModel(preferences: defaults, distribution: "testflight")
        XCTAssertEqual(restored.diagnosticPolicy, .off)
    }

    @MainActor func testRestoredSessionSurvivesTransientFailureButInvalidRefreshSignsOut() async throws {
        let name = "TonoTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        defaults.set("fixture-location", forKey: "selectedLocation")
        let vault = MemoryVault()
        let cloud = client(vault: vault)
        let model = AppModel(cloud: cloud, tunnel: StubTunnel(), preferences: defaults, distribution: "testflight")
        FixtureHTTP.script.reset([
            .init(body: Self.me), .init(body: Self.devices),
            .init(error: URLError(.notConnectedToInternet)),
            .init(status: 401), .init(status: 503),
            .init(status: 401), .init(status: 401, body: #"{"error":{"code":"INVALID_REFRESH_TOKEN"}}"#),
        ])
        await model.restore()
        await model.refreshDevices()
        XCTAssertEqual(model.user?.id, "fixture-user")
        XCTAssertEqual(model.devices.count, 1)
        await model.refreshDevices() // offline transport, not auth loss
        XCTAssertNotNil(model.user)
        XCTAssertEqual(model.devices.count, 1)
        await model.refreshDevices() // refresh endpoint temporarily unavailable
        XCTAssertNotNil(model.user)
        XCTAssertNotNil(cloud.credentials)
        XCTAssertNotNil(try vault.read("session"))
        XCTAssertEqual(model.selectedLocation, "fixture-location")
        model.challenge = EmailChallenge(challengeId: "old-challenge", expiresIn: 60)
        model.challengeExpires = .now.addingTimeInterval(60)
        let oldGeneration = model.machine.generation
        await model.refreshDevices() // invalid refresh after a successful restored /me
        XCTAssertNil(model.user) // RootView's authenticated navigation predicate
        XCTAssertFalse(model.isPreview)
        XCTAssertTrue(model.devices.isEmpty)
        XCTAssertNil(cloud.credentials)
        XCTAssertNil(try vault.read("session"))
        XCTAssertNil(model.selectedLocation)
        XCTAssertNil(defaults.string(forKey: "selectedLocation"))
        XCTAssertNil(model.challenge)
        XCTAssertNil(model.challengeExpires)
        XCTAssertTrue(model.diagnostics.events.isEmpty)
        XCTAssertEqual(model.state, .actionRequired)
        XCTAssertEqual(model.machine.blocker, .sessionExpired)
        XCTAssertNotEqual(model.machine.generation, oldGeneration)
        XCTAssertEqual(model.notice, Blocker.sessionExpired.message)
        await model.restore()
        XCTAssertNil(model.user)
        XCTAssertEqual(FixtureHTTP.script.requests.map { $0.path }, [
            "/api/v1/me", "/api/v1/devices", "/api/v1/devices", "/api/v1/devices",
            "/api/v1/auth/refresh", "/api/v1/devices", "/api/v1/auth/refresh",
        ])
    }

    @MainActor func testTerminalAuthLossClearsMemoryEvenWhenKeychainDeletionFails() async throws {
        let vault = MemoryVault()
        let cloud = client(vault: vault)
        let model = AppModel(cloud: cloud, tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([
            .init(body: Self.me), .init(status: 401),
            .init(status: 401, body: #"{"error":{"code":"INVALID_REFRESH_TOKEN"}}"#),
        ])
        await model.restore()
        XCTAssertNotNil(model.user)
        vault.failRemoval = true
        await model.refreshDevices()
        XCTAssertNil(model.user)
        XCTAssertNil(cloud.credentials)
        XCTAssertNotNil(try vault.read("session")) // deletion must NOT be falsely reported successful
        XCTAssertTrue(model.notice?.contains(Blocker.keychainUnavailable.message) == true)
        await model.restore()
        XCTAssertNil(model.user)
        XCTAssertEqual(FixtureHTTP.script.requests.count, 3) // no in-process revival
        vault.failRemoval = false
        try cloud.signOut() // retry after unlock
        XCTAssertNil(try vault.read("session"))
    }

    @MainActor func testMinimalSuccessfulPauseMakesNoRequestButRecentFailureUploads() async throws {
        let cloud = client(vault: MemoryVault())
        let tunnel = StubTunnel()
        let model = AppModel(cloud: cloud, tunnel: tunnel, preferences: nil, distribution: "production")
        FixtureHTTP.script.reset([.init(body: Self.me)])
        await model.restore()
        XCTAssertNotNil(model.user)
        FixtureHTTP.script.reset([.init(body: #"{"id":"fixture-receipt"}"#)])
        await model.pause()
        XCTAssertEqual(tunnel.pauses, 1)
        XCTAssertEqual(model.state, .paused)
        XCTAssertTrue(model.diagnostics.events.isEmpty)
        await model.uploadDiagnostics()
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)
        model.diagnostics.append(.init(kind: .admissionRefused, state: .actionRequired, blocker: .invalidPolicy,
                                      now: .now.addingTimeInterval(-21_720)), policy: .minimal)
        await model.uploadDiagnostics()
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty) // stale failure cannot send metadata-only window
        await model.connect() // missing-core gate generates one recent failure, no network or profile
        XCTAssertEqual(model.machine.blocker, .coreUnavailable)
        await model.uploadDiagnostics()
        let requests = FixtureHTTP.script.requests
        XCTAssertEqual(requests.count, 1)
        let request = try XCTUnwrap(requests.first)
        XCTAssertEqual(request.path, "/api/v1/telemetry/windows")
        XCTAssertEqual(request.method, "POST")
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: request.body) as? [String: Any])
        let window = try XCTUnwrap(root["window"] as? [String: Any])
        XCTAssertEqual(window["eventCount"] as? Int, 1)
        let events = try XCTUnwrap(window["events"] as? [[String: Any]])
        XCTAssertEqual(events.first?["code"] as? String, "coreUnavailable")
        XCTAssertNil(events.first?["elapsedMs"])
        XCTAssertTrue(model.diagnostics.events.isEmpty)
    }

    @MainActor private func client(vault: MemoryVault) -> CloudClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureHTTP.self]
        return CloudClient(vault: vault, configuration: config)
    }

    private static let me = #"{"user":{"id":"fixture-user","email":"fixture@example.invalid","deviceLimit":3}}"#
    private static let devices = #"{"devices":[{"id":"00000000-0000-4000-8000-000000000001","name":"Tono for iOS","current":false,"status":"active"}]}"#
}

@MainActor private final class MemoryVault: CredentialVault {
    var failRemoval = false
    private var session: Data? = Data(#"{"accessToken":"fixture-access","refreshToken":"fixture-invalid-refresh","user":{"id":"fixture-user","email":"fixture@example.invalid"}}"#.utf8)
    func read(_ account: String) throws -> Data? { account == "session" ? session : nil }
    func write(_ data: Data, account: String) throws { session = data }
    func remove(_ account: String) throws {
        if failRemoval { throw Blocker.keychainUnavailable }
        session = nil
    }
    func installationID() throws -> String { "fixture-installation" }
}

@MainActor private final class StubTunnel: TunnelControlling {
    private(set) var pauses = 0
    func start(generation: UUID, onDemand: Bool) async throws { throw Blocker.coreUnavailable }
    func pause() async throws { pauses += 1 }
}

// Intercepts ALL URLs for these test-only sessions, including unexpected requests.
// Locked because URLProtocol executes on URLSession's queue, not the MainActor.
private final class HTTPScript: @unchecked Sendable {
    struct Step {
        var status = 200
        var body = "{}"
        var error: URLError? = nil
    }
    struct Request {
        let path: String
        let method: String?
        let body: Data
    }
    private let lock = NSLock()
    private var steps: [Step] = []
    private var recorded: [Request] = []
    var requests: [Request] { lock.lock(); defer { lock.unlock() }; return recorded }
    func reset(_ steps: [Step]) {
        lock.lock(); defer { lock.unlock() }
        self.steps = steps
        recorded = []
    }
    func take(_ request: URLRequest) -> Step {
        var body = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            let capacity = bytes.count
            while true {
                let count = stream.read(&bytes, maxLength: capacity)
                guard count > 0 else { break }
                body.append(contentsOf: bytes.prefix(count))
            }
        }
        lock.lock(); defer { lock.unlock() }
        recorded.append(.init(path: request.url?.path ?? "", method: request.httpMethod, body: body))
        return steps.isEmpty ? Step(error: URLError(.badServerResponse)) : steps.removeFirst()
    }
}

private final class FixtureHTTP: URLProtocol, @unchecked Sendable {
    static let script = HTTPScript()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let step = Self.script.take(request)
        if let error = step.error { client?.urlProtocol(self, didFailWithError: error); return }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: step.status, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL)); return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(step.body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
