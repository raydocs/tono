import XCTest
@testable import Tono

/// No sockets: responses are released explicitly by the test.
nonisolated private final class HeldAccountProtocol: URLProtocol, @unchecked Sendable {
    final class Registry: @unchecked Sendable {
        let lock = NSLock()
        var handlers: [String: @Sendable (HeldAccountProtocol) -> Void] = [:]
    }
    static let registry = Registry()
    static func install(_ host: String, handler: @escaping @Sendable (HeldAccountProtocol) -> Void) {
        registry.lock.lock(); defer { registry.lock.unlock() }
        registry.handlers[host] = handler
    }
    static func remove(_ host: String) {
        registry.lock.lock(); defer { registry.lock.unlock() }
        registry.handlers[host] = nil
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.registry.lock.lock()
        let handler = Self.registry.handlers[request.url?.host ?? ""]
        Self.registry.lock.unlock()
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL))
            return
        }
        handler(self)
    }
    override func stopLoading() {}
    func respond(status: Int, body: String) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

@MainActor
final class AccountSessionRequestTests: XCTestCase {
    private func fixture(
        catalogConsumer: @escaping @MainActor (TonoExitCatalogResponse) async throws -> Void = { _ in },
        trafficPolicyConsumer: @escaping @MainActor (TonoTrafficPolicyResponse) async throws -> Int = { $0.revision },
        cloudFallbackConsumer: @escaping @MainActor (Bool) throws -> Void = { _ in },
        killSwitchDisarmConsumer: @escaping @MainActor () async -> Void = {},
        routeSplitConsumer: @escaping @MainActor () -> AppTrafficLedger.RouteSplit = { .init() }
    ) -> (AccountSession, URLSession, String, AsyncStream<HeldAccountProtocol>) {
        let host = "\(UUID().uuidString.lowercased()).invalid"
        let (requests, continuation) = AsyncStream<HeldAccountProtocol>.makeStream()
        HeldAccountProtocol.install(host) { continuation.yield($0) }
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [HeldAccountProtocol.self]
        let transport = URLSession(configuration: config)
        let api = TonoAPIClient(baseURL: URL(string: "https://\(host)")!, keychain: testKeychain(host), session: transport)
        let account = AccountSession(api: api, keychain: testKeychain(host), sidecar: TonoSidecarService(), descriptorConsumer: { _ in }, catalogConsumer: catalogConsumer, trafficPolicyConsumer: trafficPolicyConsumer, cloudFallbackConsumer: cloudFallbackConsumer, killSwitchDisarmConsumer: killSwitchDisarmConsumer, routeSplitConsumer: routeSplitConsumer)
        account.state = .signedOut
        return (account, transport, host, requests)
    }

    func testLateAuthMethodsFailureDoesNotReplaceAuthenticatedState() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let task = Task { await account.loadAuthMethods() }
        let request = try await nextRequest(requests)
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"new-account","email":"new@example.test"}"#.utf8))
        account.state = .ready
        request.respond(status: 400, body: #"{"error":{"code":"BAD_REQUEST","message":"old failure"}}"#)
        await task.value
        XCTAssertEqual(account.state, .ready)
        XCTAssertFalse(account.authMethodsLoading)
    }

    func testOldFailureCannotReplaceANewerSignedOutPresentation() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let task = Task { await account.loadAuthMethods() }
        let request = try await nextRequest(requests)
        account.state = .authenticating
        account.state = .signedOut
        request.respond(status: 400, body: #"{"error":{"message":"old failure"}}"#)
        await task.value
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertFalse(account.authMethodsLoading)
    }

    func testOldSuccessCannotReplaceNewerAuthMethods() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let task = Task { await account.loadAuthMethods() }
        let request = try await nextRequest(requests)
        account.state = .authenticating
        account.state = .signedOut
        let current = TonoAuthMethodsResponse(
            email: TonoAuthMethod(enabled: false, clientId: nil),
            apple: TonoAuthMethod(enabled: false, clientId: nil),
            google: TonoAuthMethod(enabled: false, clientId: nil)
        )
        account.authMethods = current
        request.respond(status: 200, body: Self.enabledMethods)
        await task.value
        XCTAssertEqual(account.authMethods, current)
        XCTAssertEqual(account.state, .signedOut)
    }

    func testCurrentSuccessPublishesMethods() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let task = Task { await account.loadAuthMethods() }
        let request = try await nextRequest(requests)
        request.respond(status: 200, body: Self.enabledMethods)
        await task.value
        XCTAssertEqual(account.authMethods?.email.enabled, true)
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertFalse(account.authMethodsLoading)
    }

    func testProtectionReleaseReloadsTheSignInMethodsItRetired() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let first = Task { await account.loadAuthMethods() }
        let retired = try await nextRequest(requests)
        // Restore internet clicked while the sign-in screen is still loading.
        let release = Task { await account.restoreDirectInternet() }
        let reload = try await nextRequest(requests)
        reload.respond(status: 200, body: Self.enabledMethods)
        await release.value
        retired.respond(status: 400, body: #"{"error":{"message":"retired failure"}}"#)
        await first.value
        XCTAssertEqual(account.authMethods?.email.enabled, true)
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertFalse(account.authMethodsLoading)
    }

    func testCurrentFailureStillReportsAnError() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let task = Task { await account.loadAuthMethods() }
        let request = try await nextRequest(requests)
        request.respond(status: 400, body: #"{"error":{"message":"current failure"}}"#)
        await task.value
        XCTAssertEqual(account.state, .error("current failure"))
        XCTAssertFalse(account.authMethodsLoading)
    }

    func testCancelledRequestDoesNotPublishAnError() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let task = Task { await account.loadAuthMethods() }
        _ = try await nextRequest(requests)
        task.cancel()
        await task.value
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertNil(account.authMethods)
        XCTAssertFalse(account.authMethodsLoading)
    }

    nonisolated private func nextRequest(_ requests: AsyncStream<HeldAccountProtocol>) async throws -> HeldAccountProtocol {
        try await withThrowingTaskGroup(of: HeldAccountProtocol.self) { group in
            group.addTask {
                for await request in requests { return request }
                throw CancellationError()
            }
            group.addTask {
                try await Task.sleep(for: .seconds(5))
                throw URLError(.timedOut)
            }
            defer { group.cancelAll() }
            return try await group.next()!
        }
    }

    private func testKeychain(_ host: String) -> KeychainStore {
        KeychainStore(service: "app.tono.tests.account-requests.\(host)")
    }

    private func adoptTestAccount(_ account: AccountSession) async throws {
        let user = try JSONDecoder().decode(TonoUser.self, from: Data(Self.originalUser.utf8))
        // Unique per-test keychain namespace, synthetic credentials, removed by
        // every fixture's defer. Never read or overwrite the user's account.
        try await account.api.adopt(TonoAuthResponse(
            accessToken: "test-only-access", refreshToken: "test-only-refresh",
            user: user, device: nil, enrollment: nil
        ))
        account.user = user
        account.state = .ready
    }

    func testSupportReportRequiresConfirmationAndSendsOnlyFrozenPreviewWithActualReceipt() async throws {
        let (account, transport, host, requests) = fixture()
        defer {
            transport.invalidateAndCancel(); HeldAccountProtocol.remove(host)
            try? testKeychain(host).remove(.refreshToken)
        }
        try await adoptTestAccount(account)
        let rawConsent = AppProfile.defaults.object(forKey: SettingsKey.networkLogUploadEnabled) as? Bool
        let remoteConsent = AppProfile.defaults.object(forKey: SettingsKey.remoteDiagnosticsEnabled) as? Bool
        let app = AppState()
        app.isProtectionBlocked = true
        app.errorMessage = "token=private-secret https://browsing.example/private"
        app.connectionCoordinator.connectAttemptID = UUID()
        let observation = await app.collectLocalHealth(account: account, probe: { .init() })
        account.previewSupportReport(try XCTUnwrap(observation))
        let draft = try XCTUnwrap(account.supportReportDraft)
        XCTAssertNil(account.uploadingSupportReportID)
        XCTAssertNil(account.supportReportReceipt)
        // A changed connection cannot send a stale preview, even with the same account.
        await account.confirmSupportReport(id: draft.id, generation: draft.health.generation + 1)
        XCTAssertNil(account.uploadingSupportReportID)
        let task = Task { await account.confirmSupportReport(id: draft.id, generation: draft.health.generation) }
        let pending = try await nextRequest(requests)
        XCTAssertEqual(pending.request.url?.path, "/api/v1/diagnostics/reports")
        XCTAssertEqual(pending.request.httpMethod, "POST")
        XCTAssertEqual(pending.request.value(forHTTPHeaderField: "Authorization"), "Bearer test-only-access")
        var data = pending.request.httpBody ?? Data()
        if let stream = pending.request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                guard count > 0 else { break }
                data.append(contentsOf: bytes.prefix(count))
            }
        }
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? NSDictionary)
        let preview = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(draft.preview.utf8)) as? NSDictionary)
        XCTAssertEqual(json, preview, "the actual request must match the approved preview")
        XCTAssertEqual(Set(json.allKeys.compactMap { $0 as? String }), ["report"])
        let report = try XCTUnwrap(json["report"] as? [String: Any])
        let wireKeys: Set<String> = ["schemaVersion", "reportedAtMs", "appVersion", "osVersion", "osArch", "serviceProtocol", "serviceBuild", "uiState", "accountState", "selectedServer", "catalogRevision", "killSwitchMode", "killSwitchWanted", "killSwitchLive", "killSwitchLastError", "dnsEnabled", "dnsLastError", "failedStage", "error", "retryAttempt", "totalElapsedMs", "steps", "virtualAdapters", "auditLogPath", "serviceLogPath"]
        XCTAssertTrue(Set(report.keys).isSubset(of: wireKeys))
        XCTAssertEqual(report["schemaVersion"] as? Int, 1)
        XCTAssertEqual(report["auditLogPath"] as? String, "")
        XCTAssertEqual(report["serviceLogPath"] as? String, "")
        XCTAssertNil(report["killSwitchLive"])
        let body = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(body.contains("private-secret"))
        XCTAssertFalse(body.contains("browsing.example"))
        XCTAssertFalse(body.contains(draft.health.attempt!.uuidString))
        XCTAssertFalse(body.contains("test-only-access"))
        pending.respond(status: 201, body: #"{"referenceCode":"TON-NATIVE-73","receivedAt":1790000000}"#)
        await task.value
        let receipt = try XCTUnwrap(account.supportReportReceipt)
        XCTAssertEqual(receipt.server.referenceCode, "TON-NATIVE-73")
        XCTAssertEqual(receipt.server.receivedAt, 1_790_000_000)
        XCTAssertTrue(receipt.copyText.contains(draft.health.attempt!.uuidString))
        XCTAssertEqual(rawConsent, AppProfile.defaults.object(forKey: SettingsKey.networkLogUploadEnabled) as? Bool)
        XCTAssertEqual(remoteConsent, AppProfile.defaults.object(forKey: SettingsKey.remoteDiagnosticsEnabled) as? Bool)
        account.discardSupportReport()
        XCTAssertFalse(draft.lease.isCurrent())
    }

    func testSupportReportAccountRetirementStopsHeldUnauthorizedRetryAndClearsReceipt() async throws {
        let (account, transport, host, requests) = fixture()
        defer {
            transport.invalidateAndCancel(); HeldAccountProtocol.remove(host)
            try? testKeychain(host).remove(.refreshToken)
        }
        try await adoptTestAccount(account)
        let app = AppState()
        let observation = await app.collectLocalHealth(account: account, probe: { .init() })
        account.previewSupportReport(try XCTUnwrap(observation))
        let draft = try XCTUnwrap(account.supportReportDraft)
        let task = Task { await account.confirmSupportReport(id: draft.id, generation: draft.health.generation) }
        let held = try await nextRequest(requests)
        // Retire synchronously before credentials are cleared, as real sign-out does.
        account.invalidateAccountReads()
        XCTAssertFalse(draft.lease.isCurrent())
        HeldAccountProtocol.install(host) { request in
            XCTFail("retired consent must not refresh credentials or retry the report")
            request.respond(status: 500, body: "{}")
        }
        held.respond(status: 401, body: #"{"error":{"message":"expired"}}"#)
        await task.value
        XCTAssertNil(account.supportReportDraft)
        XCTAssertNil(account.supportReportReceipt)
        XCTAssertNil(account.supportReportError)
    }

    func testSupportReportWithoutServerReferenceNeverClaimsReceiptOrEchoesTransportBody() async throws {
        let (account, transport, host, requests) = fixture()
        defer {
            transport.invalidateAndCancel(); HeldAccountProtocol.remove(host)
            try? testKeychain(host).remove(.refreshToken)
        }
        try await adoptTestAccount(account)
        let app = AppState()
        let observation = await app.collectLocalHealth(account: account, probe: { .init() })
        account.previewSupportReport(try XCTUnwrap(observation))
        let draft = try XCTUnwrap(account.supportReportDraft)
        let task = Task { await account.confirmSupportReport(id: draft.id, generation: draft.health.generation) }
        let held = try await nextRequest(requests)
        held.respond(status: 201, body: #"{"referenceCode":"","detail":"private-secret"}"#)
        await task.value
        XCTAssertNil(account.supportReportReceipt)
        XCTAssertNotNil(account.supportReportError)
        XCTAssertFalse(account.supportReportError!.contains("private-secret"))
        XCTAssertEqual(account.supportReportDraft?.preview, draft.preview)
    }

    func testFailedPeriodicUploadRetainsEventsUntilOwnedSnapshotIsAcknowledged() async throws {
        let (account, transport, host, requests) = fixture()
        let buffer = ConnectionTelemetryBuffer.shared
        _ = buffer.drain()
        defer {
            transport.invalidateAndCancel(); HeldAccountProtocol.remove(host)
            try? testKeychain(host).remove(.refreshToken)
            _ = buffer.drain()
        }
        try await adoptTestAccount(account)
        account.periodicTelemetryConsent = { true }
        buffer.record("connectBegin")
        let first = Task { await account.uploadPeriodicTelemetryWindow() }
        let failed = try await nextRequest(requests)
        buffer.record("connectOk")
        failed.respond(status: 503, body: #"{"error":{"message":"offline"}}"#)
        await first.value
        account.lastPeriodicTelemetryAt = nil
        let retry = Task { await account.uploadPeriodicTelemetryWindow() }
        let accepted = try await nextRequest(requests)
        let request = accepted.request
        let data: Data
        if let body = request.httpBody { data = body }
        else {
            let stream = try XCTUnwrap(request.httpBodyStream)
            stream.open(); defer { stream.close() }
            var body = Data(); var bytes = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&bytes, maxLength: bytes.count)
                guard count > 0 else { break }
                body.append(contentsOf: bytes.prefix(count))
            }
            data = body
        }
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let window = try XCTUnwrap(json["window"] as? [String: Any])
        let events = try XCTUnwrap(window["events"] as? [[String: Any]])
        XCTAssertEqual(events.compactMap { $0["kind"] as? String }, ["connectBegin", "connectOk"])
        buffer.record("disconnectOk")
        accepted.respond(status: 201, body: #"{"id":"stored-window","receivedAt":1}"#)
        await retry.value
        XCTAssertEqual(buffer.drain().events.map(\.kind), ["disconnectOk"])
    }

    func testRouteByteIntervalNegotiatesSupportAndPreservesFailedAndInFlightBytes() async throws {
        var totals = AppTrafficLedger.RouteSplit(direct: 200)
        let (account, transport, host, requests) = fixture(routeSplitConsumer: { totals })
        defer {
            transport.invalidateAndCancel(); HeldAccountProtocol.remove(host)
            try? testKeychain(host).remove(.refreshToken)
            _ = ConnectionTelemetryBuffer.shared.drain()
        }
        try await adoptTestAccount(account)
        account.periodicTelemetryConsent = { true }
        let startMs = Int64(Date().timeIntervalSince1970 * 1_000) - 8 * 60 * 60 * 1_000
        account.routeTelemetryCursor.setEnabled(true, current: .init(direct: 100), atMs: startMs)

        func begin() async throws -> (Task<Void, Never>, HeldAccountProtocol, [String: Any]) {
            account.lastPeriodicTelemetryAt = nil
            let task = Task { await account.uploadPeriodicTelemetryWindow() }
            let request = try await nextRequest(requests)
            var data = request.request.httpBody ?? Data()
            if let stream = request.request.httpBodyStream {
                stream.open(); defer { stream.close() }
                var bytes = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let count = stream.read(&bytes, maxLength: bytes.count)
                    guard count > 0 else { break }
                    data.append(contentsOf: bytes.prefix(count))
                }
            }
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
            return (task, request, try XCTUnwrap(json["window"] as? [String: Any]))
        }

        let (legacyTask, legacy, legacyWindow) = try await begin()
        XCTAssertNil(legacyWindow["bytesByRoute"])
        XCTAssertNil(legacyWindow["routeBytesInterval"])
        legacy.respond(status: 201, body: #"{"id":"legacy"}"#)
        await legacyTask.value
        let (probeTask, probe, probeWindow) = try await begin()
        XCTAssertNil(probeWindow["bytesByRoute"])
        probe.respond(status: 201, body: #"{"id":"supported","routeBytesIntervalVersion":1}"#)
        await probeTask.value
        XCTAssertEqual(account.routeTelemetryCursor.baseline.direct, 100)

        let (failedTask, failed, failedWindow) = try await begin()
        XCTAssertEqual((failedWindow["bytesByRoute"] as? [String: Int64])?["direct"], 100)
        failed.respond(status: 503, body: #"{"error":{"message":"offline"}}"#)
        await failedTask.value
        totals.direct = 300
        let (retryTask, retry, window) = try await begin()
        let interval = try XCTUnwrap(window["routeBytesInterval"] as? [String: Int64])
        XCTAssertEqual(interval["startMs"], startMs)
        XCTAssertEqual(interval["endMs"], window["windowEndMs"] as? Int64)
        XCTAssertGreaterThan(try XCTUnwrap(window["windowStartMs"] as? Int64), startMs)
        XCTAssertEqual((window["bytesByRoute"] as? [String: Int64])?["direct"], 200)
        totals.direct = 350
        retry.respond(status: 201, body: #"{"id":"recovered","routeBytesIntervalVersion":1}"#)
        await retryTask.value
        XCTAssertEqual(account.routeTelemetryCursor.baseline.direct, 300)
        XCTAssertEqual(account.routeTelemetryCursor.baselineAtMs, interval["endMs"])
        let (rollbackTask, rollback, rollbackWindow) = try await begin()
        XCTAssertEqual((rollbackWindow["bytesByRoute"] as? [String: Int64])?["direct"], 50)
        rollback.respond(status: 400, body: #"{"error":{"message":"unknown field"}}"#)
        await rollbackTask.value
        let (renegotiateTask, renegotiate, renegotiateWindow) = try await begin()
        XCTAssertNil(renegotiateWindow["bytesByRoute"])
        XCTAssertNil(renegotiateWindow["routeBytesInterval"])
        renegotiate.respond(status: 201, body: #"{"id":"legacy-again"}"#)
        await renegotiateTask.value
        XCTAssertEqual(account.routeTelemetryCursor.baseline.direct, 300)
        XCTAssertEqual(account.routeTelemetryCursor.baselineAtMs, interval["endMs"])
    }

    func testNoStoreLogReceiptReportsFailureAndRetainsTheUploadCursor() async throws {
        let (account, transport, host, requests) = fixture()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer {
            transport.invalidateAndCancel()
            HeldAccountProtocol.remove(host)
            try? testKeychain(host).remove(.refreshToken)
            try? FileManager.default.removeItem(at: directory)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let log = directory.appendingPathComponent("audit.jsonl")
        try Data("{\"a\":1}\n".utf8).write(to: log)
        try await adoptTestAccount(account)
        let api = account.api
        let uploader = DiagnosticsLogUploader(
            auditLogURL: log,
            isEnabled: { true },
            upload: { payload, session, sequence, lines, version, os in
                _ = try await api.uploadDiagnosticsLogSegment(
                    payload: payload, sessionID: session, sequence: sequence,
                    lineCount: lines, clientVersion: version, osVersion: os
                )
            }
        )
        let first = Task { await uploader.sweep() }
        let declined = try await nextRequest(requests)
        XCTAssertEqual(declined.request.url?.path, "/api/v1/diagnostics/logs")
        declined.respond(status: 200, body: #"{"segment":{"id":"not-stored","receivedAt":1},"stored":false,"reason":"not_enabled"}"#)
        guard case .failed = await first.value else {
            return XCTFail("HTTP success without storage must not be shown as uploaded")
        }
        let retry = Task { await uploader.sweep() }
        let accepted = try await nextRequest(requests)
        XCTAssertEqual(accepted.request.value(forHTTPHeaderField: "X-Tono-Log-Sequence"), declined.request.value(forHTTPHeaderField: "X-Tono-Log-Sequence"))
        XCTAssertEqual(accepted.request.value(forHTTPHeaderField: "X-Tono-Log-Lines"), "1")
        // Stored receipts from older deployments have no `stored` field.
        accepted.respond(status: 201, body: #"{"segment":{"id":"stored-segment","receivedAt":2}}"#)
        guard case .uploaded = await retry.value else {
            return XCTFail("the declined segment must remain available for retry")
        }
        guard case .idle = await uploader.sweep() else {
            return XCTFail("only the stored receipt may consume the segment")
        }
    }

    func testLateEntitlementFailureDoesNotSuspendSignedOutAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        account.user = nil
        account.state = .signedOut
        request.respond(status: 403, body: #"{"error":{"code":"USER_DISABLED"}}"#)
        await task.value
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertNil(account.entitlementDetail)
    }

    func testLateRefreshCannotOverwriteAnotherAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"replacement","email":"new@example.test"}"#.utf8))
        request.respond(status: 200, body: "{\"user\":\(Self.originalUser)}")
        await task.value
        XCTAssertEqual(account.user?.id, "replacement")
        XCTAssertEqual(account.state, .ready)
    }

    func testNewestAccountRefreshOwnsTheResult() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let first = Task { await account.refreshAccount() }
        let firstRequest = try await nextRequest(requests)
        let second = Task { await account.refreshAccount() }
        let secondRequest = try await nextRequest(requests)
        secondRequest.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test","usageBytes":200}}"#)
        await second.value
        firstRequest.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test","usageBytes":100}}"#)
        await first.value
        XCTAssertEqual(account.user?.usageBytes, 200)
    }

    func testSameAccountReauthenticationRetiresAnOldRefresh() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        account.state = .signedOut
        account.state = .authenticating
        account.state = .ready
        request.respond(status: 403, body: #"{"error":{"code":"USER_DISABLED"}}"#)
        await task.value
        XCTAssertEqual(account.state, .ready)
        XCTAssertNil(account.entitlementDetail)
    }

    func testCurrentEntitlementFailureStillBlocksTheAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        request.respond(status: 403, body: #"{"error":{"code":"USER_DISABLED"}}"#)
        await task.value
        XCTAssertEqual(account.state, .suspended)
        XCTAssertTrue(account.blockedWhileReady)
    }

    func testExplicitInvalidationRetiresReadBeforeUserIsCleared() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        // Logout/stop retire reads before their first asynchronous cleanup,
        // while the old user is still displayed. Do not run real teardown here.
        account.invalidateAccountReads()
        request.respond(status: 403, body: #"{"error":{"code":"USER_DISABLED"}}"#)
        await task.value
        XCTAssertEqual(account.state, .ready)
        XCTAssertNil(account.entitlementDetail)
    }

    func testLateCatalogDoesNotReachConsumerForAnotherAccount() async throws {
        var consumed = 0
        let (account, transport, host, requests) = fixture(catalogConsumer: { _ in consumed += 1 })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshManagedCatalog() }
        let request = try await nextRequest(requests)
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"replacement","email":"new@example.test"}"#.utf8))
        request.respond(status: 200, body: #"{"revision":1,"yaml":"fixture","sha256":"fixture"}"#)
        let accepted = await task.value
        XCTAssertFalse(accepted)
        XCTAssertEqual(consumed, 0)
        XCTAssertNil(account.lastCatalogFailureMessage)
    }

    func testCancelledPolicyReadDoesNotInventAnOutage() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshManagedTrafficPolicy(attempts: 3) }
        _ = try await nextRequest(requests)
        task.cancel()
        let accepted = await task.value
        XCTAssertFalse(accepted)
        XCTAssertNil(account.lastTrafficPolicyFailureMessage)
    }

    func testCurrentCatalogStillReachesItsConsumer() async throws {
        var consumed = 0
        let (account, transport, host, requests) = fixture(catalogConsumer: { _ in consumed += 1 })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshManagedCatalog() }
        let request = try await nextRequest(requests)
        request.respond(status: 200, body: #"{"revision":1,"yaml":"fixture","sha256":"fixture"}"#)
        let accepted = await task.value
        XCTAssertTrue(accepted)
        XCTAssertEqual(consumed, 1)
        XCTAssertNil(account.catalogRefreshTask)
    }

    func testCurrentPolicyStillReachesItsConsumer() async throws {
        var consumed = 0
        let (account, transport, host, requests) = fixture(trafficPolicyConsumer: { policy in consumed += 1; return policy.revision })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshManagedTrafficPolicy() }
        let request = try await nextRequest(requests)
        request.respond(status: 200, body: #"{"revision":7,"json":"fixture","sha256":"fixture"}"#)
        let accepted = await task.value
        XCTAssertTrue(accepted)
        XCTAssertEqual(consumed, 1)
        XCTAssertEqual(account.lastTrafficPolicyRevision, 7)
    }

    func testLatePolicySuccessDoesNotReachNewAccountConsumer() async throws {
        var consumed = 0
        let (account, transport, host, requests) = fixture(trafficPolicyConsumer: { policy in consumed += 1; return policy.revision })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshManagedTrafficPolicy() }
        let request = try await nextRequest(requests)
        account.user = nil
        account.state = .signedOut
        request.respond(status: 200, body: #"{"revision":7,"json":"fixture","sha256":"fixture"}"#)
        let accepted = await task.value
        XCTAssertFalse(accepted)
        XCTAssertEqual(consumed, 0)
        XCTAssertNil(account.lastTrafficPolicyRevision)
    }

    func testCurrentPolicyFailureStillReportsAnOutage() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshManagedTrafficPolicy() }
        let request = try await nextRequest(requests)
        request.respond(status: 400, body: #"{"error":{"message":"current failure"}}"#)
        let accepted = await task.value
        XCTAssertFalse(accepted)
        XCTAssertEqual(account.lastTrafficPolicyFailureMessage, "current failure")
    }

    func testSignedOutSessionDoesNotFetchAuthenticatedCatalogOrPolicy() async {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let catalog = await account.refreshManagedCatalog()
        let policy = await account.refreshManagedTrafficPolicy()
        XCTAssertFalse(catalog)
        XCTAssertFalse(policy)
        XCTAssertNil(account.catalogRefreshTask)
        XCTAssertNil(account.lastCatalogFailureMessage)
        XCTAssertNil(account.lastTrafficPolicyFailureMessage)
    }

    func testLeavingAndReturningToSameUserRetiresTheOldRefresh() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let original = account.user
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        account.user = nil
        account.user = original
        request.respond(status: 403, body: #"{"error":{"code":"USER_DISABLED"}}"#)
        await task.value
        XCTAssertEqual(account.state, .ready)
        XCTAssertNil(account.entitlementDetail)
    }

    func testLateUnauthorizedAfterTokenRefreshDoesNotSuspendSignedOutAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let task = Task { await account.refreshAccount() }
        let request = try await nextRequest(requests)
        request.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        let renewal = try await nextRequest(requests)
        XCTAssertTrue(renewal.request.url?.path.hasSuffix("/auth/refresh") == true)
        account.user = nil
        account.state = .signedOut
        renewal.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        await task.value
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertNil(account.entitlementDetail)
    }

    func testBackgroundUploadRefusedSessionSuspendsAndKeepsProtection() async throws {
        var released = false
        let (account, transport, host, requests) = fixture(killSwitchDisarmConsumer: { released = true })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        account.periodicTelemetryConsent = { true }
        let upload = Task { await account.uploadPeriodicTelemetryWindow() }
        // The Worker refuses an expired plan, a used-up allowance, a disabled
        // account and a revoked device alike: 401 on the request and on its
        // token renewal.
        let window = try await nextRequest(requests)
        window.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        let renewal = try await nextRequest(requests)
        XCTAssertTrue(renewal.request.url?.path.hasSuffix("/auth/refresh") == true)
        // Whatever is sent after that refusal meets a transient outage, which
        // must not undo the refusal already seen.
        HeldAccountProtocol.install(host) { request in
            request.respond(status: 503, body: #"{"error":{"message":"offline"}}"#)
        }
        renewal.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        await upload.value
        XCTAssertFalse(released, "a refused session must not release PF/DNS protection")
        XCTAssertEqual(account.state, .suspended)
        XCTAssertTrue(account.blockedWhileReady)
        XCTAssertEqual(account.user?.id, "original")
    }

    func testLaunchRefusedSessionSignsOutAndKeepsProtection() async throws {
        var released = false
        let (account, transport, host, _) = fixture(killSwitchDisarmConsumer: { released = true })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        // Launch restore after crash cleanup kept protection armed and `me`
        // plus its renewal were refused. restore() itself needs the privileged
        // helper, so its catch is driven directly.
        account.state = .restoring
        account.shouldResumeProtection = true
        HeldAccountProtocol.install(host) { request in
            request.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        }
        await account.fail(TonoAPIClient.APIError.unauthorized, signsOutOnUnauthorized: true)
        XCTAssertFalse(released, "a refused session must not release PF/DNS protection")
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertNil(account.user)
        XCTAssertNil(try testKeychain(host).string(for: .refreshToken))
        XCTAssertTrue(account.shouldResumeProtection)
    }

    func testSignInKeepsTheArmedAndResumeIntentsUnlessTheHelperConfirmsRelease() async {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); KillSwitchService.isArmed = false }
        // A launch 401 kept crash recovery's armed and resume intents; a root
        // emergency disarm since then is known only to the helper, and cannot
        // clear this user's defaults. The status seam stands in for the IPC.
        let app = AppState()
        var helperStatus = KillSwitchService.StatusObservation.unavailable
        var runtime = NetworkProtectionOperations()
        runtime.refreshKillSwitchStatus = { helperStatus }
        app.networkProtection = runtime
        account.protectionReleaseConsumer = { await app.acceptConfirmedProtectionReleaseBeforeSignIn() }
        KillSwitchService.isArmed = true
        account.shouldResumeProtection = true
        await account.retireResumeIntentIfProtectionReleased()
        XCTAssertTrue(account.shouldResumeProtection, "an unreachable helper is no evidence of a release")
        XCTAssertTrue(KillSwitchService.isArmed, "an unreachable helper must not loosen the armed intent")
        helperStatus = .confirmed(requiresProtectionRecovery: false)
        await account.retireResumeIntentIfProtectionReleased()
        XCTAssertFalse(account.shouldResumeProtection, "a confirmed release must not be re-armed by the next sign-in")
        XCTAssertFalse(KillSwitchService.isArmed, "a confirmed release must not be re-armed at the next sleep")
        // A Protected Offline native-update recovery arms without a resume intent.
        KillSwitchService.isArmed = true
        await account.retireResumeIntentIfProtectionReleased()
        XCTAssertFalse(KillSwitchService.isArmed, "an armed intent alone must still meet a confirmed release")
    }

    private func adoptReplacementCredentials(_ account: AccountSession) async throws {
        let replacement = try JSONDecoder().decode(TonoUser.self, from: Data(#"{"id":"replacement","email":"new@example.test"}"#.utf8))
        try await account.api.adopt(TonoAuthResponse(
            accessToken: "replacement-access", refreshToken: "replacement-refresh",
            user: replacement, device: nil, enrollment: nil
        ))
    }

    private func assertCancelled(_ result: Result<TonoMeResponse, Error>, file: StaticString = #filePath, line: UInt = #line) {
        switch result {
        case .success: XCTFail("An obsolete authenticated request must be cancelled", file: file, line: line)
        case .failure(let error): XCTAssertTrue(error is CancellationError, "Unexpected error: \(error)", file: file, line: line)
        }
    }

    func testOldTokenRefreshCannotOverwriteNewlyAdoptedCredentials() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let read = Task { try await account.api.me() }
        let me = try await nextRequest(requests)
        me.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        let refresh = try await nextRequest(requests)
        XCTAssertTrue(refresh.request.url?.path.hasSuffix("/auth/refresh") == true)
        try await adoptReplacementCredentials(account)
        HeldAccountProtocol.install(host) { request in
            request.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test"}}"#)
        }
        refresh.respond(status: 200, body: #"{"accessToken":"old-rotated-access","refreshToken":"old-rotated-refresh"}"#)
        assertCancelled(await read.result)
        XCTAssertEqual(try testKeychain(host).string(for: .refreshToken), "replacement-refresh")
    }

    func testOldLogoutCannotDeleteNewlyAdoptedCredentials() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let logout = Task { await account.api.logout() }
        let request = try await nextRequest(requests)
        XCTAssertTrue(request.request.url?.path.hasSuffix("/auth/logout") == true)
        try await adoptReplacementCredentials(account)
        request.respond(status: 204, body: "")
        await logout.value
        XCTAssertEqual(try testKeychain(host).string(for: .refreshToken), "replacement-refresh")
    }

    func testOldUnauthorizedCannotRenewTheReplacementAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let read = Task { try await account.api.me() }
        let me = try await nextRequest(requests)
        try await adoptReplacementCredentials(account)
        HeldAccountProtocol.install(host) { request in
            if request.request.url?.path.hasSuffix("/auth/refresh") == true {
                request.respond(status: 200, body: #"{"accessToken":"unexpected-access","refreshToken":"unexpected-refresh"}"#)
            } else {
                request.respond(status: 200, body: #"{"user":{"id":"replacement","email":"new@example.test"}}"#)
            }
        }
        me.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        assertCancelled(await read.result)
        XCTAssertEqual(try testKeychain(host).string(for: .refreshToken), "replacement-refresh")
    }

    func testLogoutPreventsLateUnauthorizedFromRotatingTheTokenBeingRevoked() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let read = Task { try await account.api.me() }
        let me = try await nextRequest(requests)
        let logout = Task { await account.api.logout() }
        let revoke = try await nextRequest(requests)
        XCTAssertTrue(revoke.request.url?.path.hasSuffix("/auth/logout") == true)
        HeldAccountProtocol.install(host) { request in
            if request.request.url?.path.hasSuffix("/auth/refresh") == true {
                request.respond(status: 200, body: #"{"accessToken":"unexpected-access","refreshToken":"unexpected-refresh"}"#)
            } else {
                request.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test"}}"#)
            }
        }
        me.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        assertCancelled(await read.result)
        revoke.respond(status: 204, body: "")
        await logout.value
        XCTAssertNil(try testKeychain(host).string(for: .refreshToken))
    }

    func testCurrentTokenRefreshStillRotatesAndRetriesTheRead() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let read = Task { try await account.api.me() }
        let me = try await nextRequest(requests)
        me.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        let refresh = try await nextRequest(requests)
        refresh.respond(status: 200, body: #"{"accessToken":"rotated-access","refreshToken":"rotated-refresh"}"#)
        let retried = try await nextRequest(requests)
        XCTAssertEqual(retried.request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access")
        retried.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test"}}"#)
        let response = try await read.value
        XCTAssertEqual(response.user.id, "original")
        XCTAssertEqual(try testKeychain(host).string(for: .refreshToken), "rotated-refresh")
    }

    func testLogoutCanRenewThenRevokeTheRotatedSession() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let logout = Task { await account.api.logout() }
        let first = try await nextRequest(requests)
        first.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        let refresh = try await nextRequest(requests)
        XCTAssertTrue(refresh.request.url?.path.hasSuffix("/auth/refresh") == true)
        refresh.respond(status: 200, body: #"{"accessToken":"rotated-access","refreshToken":"rotated-refresh"}"#)
        let revoke = try await nextRequest(requests)
        XCTAssertTrue(revoke.request.url?.path.hasSuffix("/auth/logout") == true)
        XCTAssertEqual(revoke.request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access")
        XCTAssertEqual(try testKeychain(host).string(for: .refreshToken), "rotated-refresh")
        revoke.respond(status: 204, body: "")
        await logout.value
        XCTAssertNil(try testKeychain(host).string(for: .refreshToken))
    }

    func testLogoutRejectsNewAuthenticatedReadsUntilItFinishes() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let logout = Task { await account.api.logout() }
        let revoke = try await nextRequest(requests)
        // The held revocation proves logout has entered its actor-owned phase.
        let read = Task { try await account.api.me() }
        assertCancelled(await read.result)
        revoke.respond(status: 204, body: "")
        await logout.value
        XCTAssertNil(try testKeychain(host).string(for: .refreshToken))
    }

    func testLogoutDrainsAnAlreadyRotatingTokenBeforeRevoking() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let read = Task { try await account.api.me() }
        let me = try await nextRequest(requests)
        me.respond(status: 401, body: #"{"error":{"code":"UNAUTHORIZED"}}"#)
        let refresh = try await nextRequest(requests)
        let logout = Task { await account.api.logout() }
        refresh.respond(status: 200, body: #"{"accessToken":"rotated-access","refreshToken":"rotated-refresh"}"#)
        let next = try await nextRequest(requests)
        // If the refresh continuation won the actor race, finish that read;
        // either legal ordering must revoke the rotated credential, not its predecessor.
        let revoke: HeldAccountProtocol
        if next.request.url?.path.hasSuffix("/me") == true {
            next.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test"}}"#)
            revoke = try await nextRequest(requests)
        } else {
            revoke = next
        }
        XCTAssertTrue(revoke.request.url?.path.hasSuffix("/auth/logout") == true)
        XCTAssertEqual(revoke.request.value(forHTTPHeaderField: "Authorization"), "Bearer rotated-access")
        revoke.respond(status: 204, body: "")
        _ = await read.result
        await logout.value
        XCTAssertNil(try testKeychain(host).string(for: .refreshToken))
    }

    func testInvalidAdoptionLeavesTheCurrentCredentialsUsable() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        do {
            try await account.api.adopt(TonoAuthResponse(
                accessToken: "invalid-new-access", refreshToken: nil,
                user: try XCTUnwrap(account.user), device: nil, enrollment: nil
            ))
            XCTFail("Missing refresh token must be refused")
        } catch {
            XCTAssertEqual(error as? TonoAPIClient.APIError, .invalidResponse)
        }
        let read = Task { try await account.api.me() }
        let me = try await nextRequest(requests)
        XCTAssertEqual(me.request.value(forHTTPHeaderField: "Authorization"), "Bearer test-only-access")
        me.respond(status: 200, body: #"{"user":{"id":"original","email":"old@example.test"}}"#)
        _ = try await read.value
        XCTAssertEqual(try testKeychain(host).string(for: .refreshToken), "test-only-refresh")
    }

    func testCancelledAuthenticationDoesNotAdoptLateCredentials() async throws {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let entered = AccountResponseGate()
        let release = AccountResponseGate()
        let user = try JSONDecoder().decode(TonoUser.self, from: Data(Self.originalUser.utf8))
        let authentication = Task {
            await account.authenticate {
                entered.open()
                await release.wait() // deliberately non-cooperative completion
                return TonoAuthResponse(accessToken: "late-access", refreshToken: "late-refresh", user: user, device: nil, enrollment: nil)
            }
        }
        await entered.wait()
        authentication.cancel()
        release.open()
        await authentication.value
        XCTAssertNil(account.user)
        XCTAssertNil(try testKeychain(host).string(for: .refreshToken))
    }

    func testLateDeviceInventoryDoesNotRepopulateASignedOutAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let reload = Task { try await account.reloadDevices() }
        let request = try await nextRequest(requests)
        account.user = nil
        account.state = .signedOut
        request.respond(status: 200, body: #"{"devices":[{"id":"old-device","name":"Old device"}]}"#)
        _ = await reload.result
        XCTAssertTrue(account.devices.isEmpty)
    }

    func testNewestDeviceInventoryOwnsTheResult() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let first = Task { try await account.reloadDevices() }
        let firstRequest = try await nextRequest(requests)
        let second = Task { try await account.reloadDevices() }
        let secondRequest = try await nextRequest(requests)
        secondRequest.respond(status: 200, body: #"{"devices":[{"id":"new-device","name":"New device"}]}"#)
        _ = try await second.value
        firstRequest.respond(status: 200, body: #"{"devices":[{"id":"old-device","name":"Old device"}]}"#)
        _ = await first.result
        XCTAssertEqual(account.devices.map(\.id), ["new-device"])
    }

    func testLateRevokeFailureDoesNotWriteIntoAnotherAccount() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let target = try JSONDecoder().decode(TonoDevice.self, from: Data(#"{"id":"00000000-0000-0000-0000-000000000007","name":"Old device"}"#.utf8))
        let revoke = Task { await account.revoke(target) }
        let request = try await nextRequest(requests)
        account.user = nil
        account.state = .signedOut
        request.respond(status: 400, body: #"{"error":{"message":"old revoke failure"}}"#)
        await revoke.value
        XCTAssertNil(account.deviceActionError)
    }

    func testOlderPolicyResponseDoesNotDowngradeRevisionDiagnostics() async throws {
        let (account, transport, host, requests) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let first = Task { await account.refreshManagedTrafficPolicy() }
        let firstRequest = try await nextRequest(requests)
        let second = Task { await account.refreshManagedTrafficPolicy() }
        let secondRequest = try await nextRequest(requests)
        secondRequest.respond(status: 200, body: #"{"revision":8,"json":"fixture","sha256":"fixture"}"#)
        _ = await second.value
        firstRequest.respond(status: 200, body: #"{"revision":7,"json":"fixture","sha256":"fixture"}"#)
        _ = await first.value
        XCTAssertEqual(account.lastTrafficPolicyRevision, 8)
    }

    func testCancelledFallbackCannotReactivateProtection() async throws {
        var activated = false
        let (account, transport, host, _) = fixture(cloudFallbackConsumer: { _ in activated = true })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let fallback = Task { try await account.activateCloudFallback(resumeProtection: true) }
        fallback.cancel()
        _ = await fallback.result
        XCTAssertFalse(activated)
    }

    func testPolicyDiagnosticsReportTheActuallyInstalledRevision() async throws {
        let (account, transport, host, requests) = fixture(trafficPolicyConsumer: { _ in 100 })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        try await adoptTestAccount(account)
        let refresh = Task { await account.refreshManagedTrafficPolicy() }
        let request = try await nextRequest(requests)
        request.respond(status: 200, body: #"{"revision":7,"json":"fixture","sha256":"fixture"}"#)
        let accepted = await refresh.value
        XCTAssertTrue(accepted)
        XCTAssertEqual(account.lastTrafficPolicyRevision, 100)
    }

    func testRuntimeMonitorCancellationDrainsBeforeReturning() async {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let entered = AccountResponseGate()
        let release = AccountResponseGate()
        var finished = false
        account.runtimeMonitor = Task {
            await withTaskCancellationHandler {
                entered.open()
                await release.wait()
                finished = true
            } onCancel: {
                Task { @MainActor in release.open() }
            }
        }
        await entered.wait()
        await account.cancelRuntimeMonitor()
        XCTAssertTrue(finished)
        XCTAssertNil(account.runtimeMonitor)
    }

    func testAccountEntryPointsCannotStartDuringCleanup() async {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host); try? testKeychain(host).remove(.refreshToken) }
        let release = AccountResponseGate()
        let cleanup = account.accountLifecycle.enqueueCleanup(kind: .signOut) {
            await release.wait()
        }
        // Even invalid input cannot replace the cleanup's current presentation.
        await account.requestEmailCode(email: "invalid", deviceName: "fixture")
        await account.verifyEmailCode("123")
        XCTAssertEqual(account.state, .signedOut)
        XCTAssertTrue(account.accountLifecycle.isBusy)
        release.open()
        await cleanup.value
        XCTAssertFalse(account.accountLifecycle.isBusy)
    }

    func testAccountReleaseCannotDisarmAfterDisconnectOwnerRetainsProtection() async {
        let app = AppState()
        app.isConnected = true
        app.coreRuntime.isRunning = true
        var coreRunning = true
        var barrierArmed = true
        var events: [String] = []
        var runtime = NetworkProtectionOperations()
        runtime.repairForRelease = {}
        runtime.stopCore = { _ in events.append("stop-refused"); return false }
        runtime.coreStatus = { (coreRunning, true) }
        runtime.restoreDNS = { events.append("dns-restored"); return true }
        runtime.disableSystemProxy = {}
        runtime.disarm = { events.append("disarmed"); barrierArmed = false }
        runtime.restrictToBootstrap = { events.append("restricted"); barrierArmed = true }
        app.networkProtection = runtime
        let (account, transport, host, _) = fixture(killSwitchDisarmConsumer: {
            await app.disconnectAndWait(releaseKillSwitch: true)
        })
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host) }

        // The real AccountSession -> AppState -> coordinator release path runs;
        // only helper/system I/O is replaced. Account cleanup cannot overrule
        // the owner's refusal to open PF while its Core remains alive.
        await account.releaseNetworkProtection()
        XCTAssertTrue(barrierArmed, "account fallback must not disarm after Core-stop refusal")
        XCTAssertTrue(app.isProtectionBlocked)
        XCTAssertFalse(app.isConnected)
        XCTAssertFalse(app.isDisconnecting)
        XCTAssertEqual(events, ["stop-refused", "dns-restored", "restricted"])

        // A later explicit retry still owns the same transaction and may open
        // PF after a successful stop; retaining protection is not a dead end.
        events.removeAll()
        app.networkProtection.stopCore = { runtime in
            coreRunning = false
            runtime.isRunning = false
            events.append("stopped")
            return true
        }
        await account.releaseNetworkProtection()
        XCTAssertFalse(barrierArmed)
        XCTAssertFalse(app.isProtectionBlocked)
        XCTAssertEqual(events, ["stopped", "dns-restored", "disarmed"])
    }

    func testProtectionReleaseMakesInterruptedAuthenticatedStartupRetryable() throws {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host) }
        account.user = try JSONDecoder().decode(TonoUser.self, from: Data(Self.originalUser.utf8))
        for interrupted: AccountSession.State in [.restoring, .authenticating, .enrolling] {
            account.state = interrupted
            account.finishInterruptedAccountWorkAfterProtectionRelease()
            guard case .error = account.state else {
                XCTFail("Interrupted account startup must offer retry, not remain busy or claim ready")
                continue
            }
        }
    }

    func testProtectionReleaseReturnsAnUnownedInterruptedStartupToSignIn() {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host) }
        for interrupted: AccountSession.State in [.restoring, .authenticating, .enrolling] {
            account.state = interrupted
            account.finishInterruptedAccountWorkAfterProtectionRelease()
            XCTAssertEqual(account.state, .signedOut)
        }
    }

    func testProtectionReleasePreservesEstablishedAccountPresentations() {
        let (account, transport, host, _) = fixture()
        defer { transport.invalidateAndCancel(); HeldAccountProtocol.remove(host) }
        for stable: AccountSession.State in [.ready, .signedOut, .suspended, .error("existing error")] {
            account.state = stable
            account.finishInterruptedAccountWorkAfterProtectionRelease()
            XCTAssertEqual(account.state, stable)
        }
    }

    private static let originalUser = #"{"id":"original","email":"old@example.test"}"#

    private static let enabledMethods = #"{"email":{"enabled":true},"apple":{"enabled":false},"google":{"enabled":false}}"#

}

@MainActor
private final class AccountResponseGate {
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        guard !opened else { return }
        await withCheckedContinuation { waiters.append($0) }
    }
    func open() {
        opened = true
        let pending = waiters
        waiters.removeAll()
        for waiter in pending { waiter.resume() }
    }
}
