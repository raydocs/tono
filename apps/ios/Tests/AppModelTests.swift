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
        XCTAssertEqual(model.accountRecovery, .finishSignOut)
        await model.retryAccountRecovery() // same action exposed on the signed-out screen
        XCTAssertNil(try vault.read("session"))
        XCTAssertNil(model.accountRecovery)
    }

    @MainActor func testTerminalMarkerFailureFencesRecreationAndStillAttemptsCredentialDeletion() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let intent = FaultingLogoutIntent(directory: directory)
        let vault = MemoryVault()
        let cloud = client(vault: vault, logoutDirectory: directory, logoutIntent: intent)
        let model = AppModel(cloud: cloud, tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([
            .init(body: Self.me), .init(status: 401),
            .init(status: 401, body: #"{"error":{"code":"INVALID_REFRESH_TOKEN"}}"#),
        ])
        await model.restore()
        XCTAssertNotNil(model.user)
        intent.failMark = true
        vault.failRemoval = true
        await model.refreshDevices()
        XCTAssertNil(model.user)
        XCTAssertNil(cloud.credentials)
        XCTAssertTrue(cloud.logoutPending)
        XCTAssertEqual(model.accountRecovery, .finishSignOut)
        XCTAssertTrue(model.notice?.contains("cleanup is incomplete") == true)
        XCTAssertNotNil(try vault.read("session"))
        XCTAssertFalse(try intent.isPending()) // do not confuse the process fence with durable intent
        XCTAssertEqual(vault.removals, 1) // marker failure must not skip attempted credential deletion

        // New model, client AND marker-store instance. Server would accept the
        // retained bytes; neither restore nor direct authenticated calls may use them.
        let nextIntent = FaultingLogoutIntent(directory: directory)
        nextIntent.failMark = true
        let nextCloud = client(vault: vault, logoutDirectory: directory, logoutIntent: nextIntent)
        let next = AppModel(cloud: nextCloud, tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([.init(body: Self.me)])
        await next.restore()
        XCTAssertNil(next.user)
        XCTAssertNil(nextCloud.credentials)
        XCTAssertEqual(next.accountRecovery, .finishSignOut)
        do { _ = try await cloud.me(); XCTFail("Terminally invalidated credentials were usable") }
        catch { XCTAssertEqual(error as? Blocker, .sessionExpired) }
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)

        vault.failRemoval = false // marker writes STILL fail; fallback deletion can now succeed
        await next.retryAccountRecovery()
        XCTAssertNil(try vault.read("session"))
        XCTAssertEqual(next.accountRecovery, .finishSignOut) // bookkeeping failure is not hidden
        XCTAssertFalse(try nextIntent.isPending())
        nextIntent.processBlocked = false // simulate loss of all volatile state at process termination
        let cold = AppModel(cloud: client(vault: vault, logoutDirectory: directory),
                            tunnel: StubTunnel(), preferences: nil)
        await cold.restore()
        XCTAssertNil(cold.user)
        XCTAssertNil(cold.accountRecovery)
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty) // successful deletion protects a later launch
    }

    @MainActor func testDurableCleanupRetryNeverRewritesIntentAndRetainsItThroughReadAndClearFailures() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let intent = FaultingLogoutIntent(directory: directory)
        let vault = MemoryVault()
        let model = AppModel(cloud: client(vault: vault, logoutDirectory: directory, logoutIntent: intent),
                             tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([.init(body: Self.me)])
        await model.restore()
        vault.failRemoval = true
        await model.signOut()
        XCTAssertEqual(model.accountRecovery, .finishSignOut)
        XCTAssertTrue(try intent.isPending())
        XCTAssertEqual(intent.marks, 1)

        intent.failMark = true // a rewrite would fail, but the existing durable intent is sufficient
        vault.failRemoval = false
        intent.failClear = true
        await model.retryAccountRecovery()
        XCTAssertNil(try vault.read("session"))
        XCTAssertTrue(try intent.isPending()) // failed marker removal must continue blocking new auth
        XCTAssertEqual(model.accountRecovery, .finishSignOut)
        XCTAssertEqual(intent.marks, 1)
        intent.failRead = true
        await model.retryAccountRecovery()
        XCTAssertNil(model.user)
        XCTAssertEqual(model.accountRecovery, .finishSignOut)
        intent.failRead = false
        XCTAssertTrue(try intent.isPending())
        intent.failClear = false
        await model.retryAccountRecovery()
        XCTAssertNil(model.user)
        XCTAssertNil(model.accountRecovery)
        XCTAssertFalse(try intent.isPending())
        XCTAssertFalse(intent.processBlocked)
        XCTAssertEqual(intent.marks, 1)
        XCTAssertEqual(FixtureHTTP.script.requests.map(\.path), ["/api/v1/me"])
    }

    @MainActor func testMalformedColdStartCanForgetSessionThroughPendingCleanupAndRecreation() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let vault = MemoryVault()
        try vault.write(Data("{}".utf8), account: "session")
        let model = AppModel(cloud: client(vault: vault, logoutDirectory: directory),
                             tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([.init(body: Self.me)])
        await model.restore()
        XCTAssertNil(model.user)
        XCTAssertEqual(model.accountRecovery, .forgetSavedSession) // not the offline/503 retry loop
        XCTAssertEqual(model.notice, Blocker.savedSessionCorrupt.message)
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)
        vault.failRemoval = true
        await model.retryAccountRecovery() // the visible Forget saved sign-in action
        XCTAssertEqual(model.accountRecovery, .finishSignOut)
        XCTAssertTrue(try LogoutIntentStore(directory: directory).isPending())
        LogoutIntentStore(directory: directory).processBlocked = false // cold-process simulation
        let next = AppModel(cloud: client(vault: vault, logoutDirectory: directory),
                            tunnel: StubTunnel(), preferences: nil)
        await next.restore()
        XCTAssertEqual(next.accountRecovery, .finishSignOut) // honors intent before decoding old bytes
        XCTAssertNil(next.user)
        vault.failRemoval = false
        await next.retryAccountRecovery()
        XCTAssertNil(try vault.read("session"))
        XCTAssertNil(next.accountRecovery)
        XCTAssertFalse(try LogoutIntentStore(directory: directory).isPending())
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)
        FixtureHTTP.script.reset([.init(body: #"{"challengeId":"new-challenge","expiresIn":60}"#)])
        await next.sendCode(email: "fixture@example.invalid")
        XCTAssertEqual(next.challenge?.challengeId, "new-challenge")
        XCTAssertEqual(FixtureHTTP.script.requests.map(\.path), ["/api/v1/auth/email/start"])
    }

    @MainActor func testExplicitLogoutSurvivesClientRecreationUntilDeletionCompletes() async throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        let vault = MemoryVault()
        let firstCloud = client(vault: vault, logoutDirectory: directory)
        let first = AppModel(cloud: firstCloud, tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([.init(body: Self.me)])
        await first.restore() // server accepts this retained session
        XCTAssertEqual(first.user?.id, "fixture-user")
        // A regular file blocks creation of the intent directory: no durable intent,
        // so explicit logout must report failure and keep its retry reachable.
        try Data([0]).write(to: directory)
        await first.signOut()
        XCTAssertEqual(first.user?.id, "fixture-user")
        XCTAssertNotNil(firstCloud.credentials)
        XCTAssertNotNil(try vault.read("session"))
        XCTAssertEqual(first.notice, Blocker.keychainUnavailable.message)
        try FileManager.default.removeItem(at: directory)
        vault.failRemoval = true
        await first.signOut()
        XCTAssertNil(first.user)
        XCTAssertNil(firstCloud.credentials)
        XCTAssertEqual(first.accountRecovery, .finishSignOut)
        XCTAssertNotNil(try vault.read("session"))
        XCTAssertTrue(try LogoutIntentStore(directory: directory).isPending())

        // Discard the volatile fence, then create a fresh client/model/store against
        // the same retained vault and directory (cold-process simulation). The server
        // would STILL accept /me: a memory-only latch or invalid-token fixture cannot pass.
        LogoutIntentStore(directory: directory).processBlocked = false
        let secondCloud = client(vault: vault, logoutDirectory: directory)
        let second = AppModel(cloud: secondCloud, tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([.init(body: Self.me)])
        await second.restore()
        XCTAssertNil(second.user)
        XCTAssertNil(secondCloud.credentials)
        XCTAssertEqual(second.accountRecovery, .finishSignOut)
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)
        await second.sendCode(email: "fixture@example.invalid")
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty) // pending deletion also gates new auth
        XCTAssertTrue(try LogoutIntentStore(directory: directory).isPending())

        vault.failRemoval = false
        await second.retryAccountRecovery()
        XCTAssertNil(try vault.read("session"))
        XCTAssertFalse(try LogoutIntentStore(directory: directory).isPending())
        XCTAssertNil(second.accountRecovery)
        XCTAssertNil(second.user)
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)
        let third = AppModel(cloud: client(vault: vault, logoutDirectory: directory), tunnel: StubTunnel(), preferences: nil)
        await third.restore()
        XCTAssertNil(third.user)
        XCTAssertNil(third.accountRecovery) // ordinary email login, not a stranded cleanup screen
        XCTAssertTrue(FixtureHTTP.script.requests.isEmpty)
        FixtureHTTP.script.reset([.init(body: #"{"challengeId":"new-challenge","expiresIn":60}"#)])
        await third.sendCode(email: "fixture@example.invalid")
        XCTAssertEqual(third.challenge?.challengeId, "new-challenge")
        XCTAssertEqual(FixtureHTTP.script.requests.map(\.path), ["/api/v1/auth/email/start"])
    }

    @MainActor func testColdStartRetriesTransientRestoreWithoutNewAuthentication() async throws {
        let vault = MemoryVault()
        let retained = try XCTUnwrap(vault.read("session"))
        let cloud = client(vault: vault)
        let model = AppModel(cloud: cloud, tunnel: StubTunnel(), preferences: nil)
        FixtureHTTP.script.reset([
            .init(error: URLError(.notConnectedToInternet)), .init(status: 503), .init(body: Self.me),
        ])
        await model.restore() // initial cold start, never previously authorized in this process
        XCTAssertNil(model.user)
        XCTAssertNil(model.challenge)
        XCTAssertEqual(model.accountRecovery, .restoreSession)
        XCTAssertEqual(cloud.credentials?.accessToken, "fixture-access")
        XCTAssertEqual(try vault.read("session"), retained)
        await model.retryAccountRecovery() // online, service still temporarily unavailable
        XCTAssertNil(model.user)
        XCTAssertEqual(model.accountRecovery, .restoreSession)
        XCTAssertEqual(try vault.read("session"), retained)
        await model.retryAccountRecovery()
        XCTAssertEqual(model.user?.id, "fixture-user")
        XCTAssertNil(model.accountRecovery)
        XCTAssertNil(model.challenge)
        XCTAssertEqual(try vault.read("session"), retained)
        XCTAssertEqual(FixtureHTTP.script.requests.map(\.path), ["/api/v1/me", "/api/v1/me", "/api/v1/me"])
        XCTAssertEqual(FixtureHTTP.script.requests.map(\.authorization),
                       ["Bearer fixture-access", "Bearer fixture-access", "Bearer fixture-access"])
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

    @MainActor private func client(vault: MemoryVault, logoutDirectory: URL? = nil,
                                   logoutIntent: (any LogoutIntentStoring)? = nil) -> CloudClient {
        let directory = logoutDirectory ?? FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        addTeardownBlock {
            await MainActor.run { LogoutIntentStore(directory: directory).processBlocked = false }
            if FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.removeItem(at: directory)
            }
        }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [FixtureHTTP.self]
        return CloudClient(vault: vault, configuration: config,
                           logoutIntent: logoutIntent ?? LogoutIntentStore(directory: directory))
    }

    private static let me = #"{"user":{"id":"fixture-user","email":"fixture@example.invalid","deviceLimit":3}}"#
    private static let devices = #"{"devices":[{"id":"00000000-0000-4000-8000-000000000001","name":"Tono for iOS","current":false,"status":"active"}]}"#
}

@MainActor private final class MemoryVault: CredentialVault {
    var failRemoval = false
    private(set) var removals = 0
    private var session: Data? = Data(#"{"accessToken":"fixture-access","refreshToken":"fixture-refresh","user":{"id":"fixture-user","email":"fixture@example.invalid"}}"#.utf8)
    func read(_ account: String) throws -> Data? { account == "session" ? session : nil }
    func write(_ data: Data, account: String) throws { session = data }
    func remove(_ account: String) throws {
        removals += 1
        if failRemoval { throw Blocker.keychainUnavailable }
        session = nil
    }
    func installationID() throws -> String { "fixture-installation" }
}

@MainActor private final class FaultingLogoutIntent: LogoutIntentStoring {
    let store: LogoutIntentStore
    var failMark = false
    var failRead = false
    var failClear = false
    private(set) var marks = 0
    init(directory: URL) { store = LogoutIntentStore(directory: directory) }
    var processBlocked: Bool {
        get { store.processBlocked }
        set { store.processBlocked = newValue }
    }
    func isPending() throws -> Bool {
        if failRead { throw Blocker.keychainUnavailable }
        return try store.isPending()
    }
    func mark() throws {
        marks += 1
        if failMark { throw Blocker.keychainUnavailable }
        try store.mark()
    }
    func clear() throws {
        if failClear { throw Blocker.keychainUnavailable }
        try store.clear()
    }
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
        let authorization: String?
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
        recorded.append(.init(path: request.url?.path ?? "", method: request.httpMethod, body: body,
                              authorization: request.value(forHTTPHeaderField: "Authorization")))
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
