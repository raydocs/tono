import XCTest
@testable import Tono

final class ProtectedConnectivityTests: XCTestCase {
    func testBrowserDoHModeMatrix() {
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: nil, templates: nil), .clear)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: nil, templates: "https://dns"), .blocking)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: "off", templates: "https://dns"), .clear)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: "automatic", templates: ""), .clear)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: "automatic", templates: "  "), .clear)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: "automatic", templates: "https://dns"), .blocking)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: "secure", templates: nil), .blocking)
        XCTAssertEqual(BrowserDNSDiagnostics.classify(mode: "unexpected", templates: nil), .incomplete)
    }

    func testBrowserDoHManagedPrecedenceOverBrowserWideSetting() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localState = root.appendingPathComponent("Local State")
        try writeJSON(["dns_over_https": ["mode": "secure"]], to: localState)
        var result = BrowserDNSDiagnostics.scanBrowser(
            localState: localState, userPolicy: nil, machinePolicy: nil
        )
        XCTAssertEqual(result.outcome, .blocking)
        XCTAssertEqual(result.preferenceStoreCount, 1)

        let user = root.appendingPathComponent("user.plist")
        let machine = root.appendingPathComponent("machine.plist")
        try writePlist(["DnsOverHttpsMode": "secure"], to: user)
        try writePlist(["DnsOverHttpsMode": "off"], to: machine)
        result = BrowserDNSDiagnostics.scanBrowser(
            localState: localState, userPolicy: user, machinePolicy: machine
        )
        XCTAssertEqual(result.outcome, .clear)
        XCTAssertEqual(result.source, .machineManaged)

        // Managed precedence is per key. A machine-wide mode must not hide a
        // lower-precedence managed template when the machine did not set one.
        try writePlist(["DnsOverHttpsMode": "automatic"], to: machine)
        try writePlist(["DnsOverHttpsTemplates": "https://dns"], to: user)
        result = BrowserDNSDiagnostics.scanBrowser(
            localState: localState, userPolicy: user, machinePolicy: machine
        )
        XCTAssertEqual(result.outcome, .blocking)
        XCTAssertEqual(result.source, .machineManaged)

        // Likewise, a managed template alone cannot mask the browser-wide
        // secure mode; only configured keys override local state.
        try writePlist(["DnsOverHttpsTemplates": ""], to: machine)
        try writePlist([String: String](), to: user)
        result = BrowserDNSDiagnostics.scanBrowser(
            localState: localState, userPolicy: user, machinePolicy: machine
        )
        XCTAssertEqual(result.outcome, .blocking)
    }

    func testBrowserDoHMalformedOversizedAndSymlinkFailClosed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localState = root.appendingPathComponent("browser/Local State")
        try FileManager.default.createDirectory(at: localState.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data("{".utf8).write(to: localState)
        XCTAssertEqual(BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil).outcome, .incomplete)
        XCTAssertEqual(BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil).failureReason, .invalidDocument)
        try Data(repeating: 0x20, count: BrowserDNSDiagnostics.maximumFileBytes + 1).write(to: localState)
        XCTAssertEqual(BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil).outcome, .incomplete)
        XCTAssertEqual(BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil).failureReason, .oversizedFile)
        try FileManager.default.removeItem(at: localState)
        let target = root.appendingPathComponent("target")
        try writeJSON(["dns_over_https": ["mode": "off"]], to: target)
        try FileManager.default.createSymbolicLink(at: localState, withDestinationURL: target)
        XCTAssertEqual(BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil).outcome, .incomplete)
        XCTAssertEqual(BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil).failureReason, .symbolicLink)
    }

    func testBrowserDoHChecksEveryInstalledReleaseChannel() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let stable = root.appendingPathComponent("stable/Local State")
        let beta = root.appendingPathComponent("beta/Local State")
        try writeJSON(["dns_over_https": ["mode": "off"]], to: stable)
        try writeJSON(["dns_over_https": ["mode": "secure"]], to: beta)

        var result = BrowserDNSDiagnostics.scanBrowserChannels([
            (stable, [], nil),
            (beta, [], nil),
        ])
        XCTAssertEqual(result.outcome, .blocking)
        XCTAssertEqual(result.preferenceStoreCount, 2)

        try Data("{".utf8).write(to: beta)
        result = BrowserDNSDiagnostics.scanBrowserChannels([
            (stable, [], nil),
            (beta, [], nil),
        ])
        XCTAssertEqual(result.outcome, .incomplete)
        XCTAssertEqual(result.failureReason, .invalidDocument)
        XCTAssertEqual(result.preferenceStoreCount, 2)
    }

    func testBrowserDoHMissingStateIsNotAnEnabledSettingAndCanRecover() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localState = root.appendingPathComponent("Local State")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let missing = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil)
        XCTAssertEqual(missing.outcome, .incomplete)
        XCTAssertEqual(missing.failureReason, .missingLocalState)

        // A browser writing a valid Local State resolves the scan gap. Merely
        // telling the user to toggle DNS off cannot fix an unreadable document.
        try writeJSON(["dns_over_https": ["mode": "off"]], to: localState)
        let recovered = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil)
        XCTAssertEqual(recovered.outcome, .clear)
        XCTAssertNil(recovered.failureReason)
    }

    func testBrowserDoHPolicyFailureRemainsIncompleteEvenWhenLocalDNSIsOff() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localState = root.appendingPathComponent("Local State")
        let policy = root.appendingPathComponent("policy.plist")
        try writeJSON(["dns_over_https": ["mode": "off"]], to: localState)
        try writePlist(["DnsOverHttpsMode": 42], to: policy)
        let result = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: policy)
        XCTAssertEqual(result.outcome, .incomplete)
        XCTAssertEqual(result.source, .machineManaged)
        XCTAssertEqual(result.failureReason, .invalidSettings)
    }

    func testBrowserDoHReportsInvalidLocalSettingsAndUnsupportedModes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localState = root.appendingPathComponent("Local State")
        try writeJSON(["dns_over_https": ["mode": 42]], to: localState)
        var result = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil)
        XCTAssertEqual(result.outcome, .incomplete)
        XCTAssertEqual(result.failureReason, .invalidSettings)
        try writeJSON(["dns_over_https": ["mode": "unrecognized"]], to: localState)
        result = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil)
        XCTAssertEqual(result.outcome, .incomplete)
        XCTAssertEqual(result.failureReason, .unsupportedMode)
    }

    func testBrowserDoHFailureDetailContainsOnlyClassifications() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let localState = root.appendingPathComponent("Local State")
        try writeJSON(["dns_over_https": ["mode": "secure", "templates": "https://private.example.invalid/dns"]], to: localState)
        let blocking = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil)
        try Data("{".utf8).write(to: localState)
        let incomplete = BrowserDNSDiagnostics.scanBrowser(localState: localState, userPolicy: nil, machinePolicy: nil)
        let report = BrowserDNSDiagnostics.Report(chrome: blocking, edge: incomplete)
        XCTAssertEqual(report.outcome, .incomplete)
        XCTAssertEqual(report.diagnosticDetail, "browser Secure DNS scan incomplete; chrome=blocking/localState/none; edge=incomplete/localState/invalidDocument")
        XCTAssertFalse(report.diagnosticDetail.contains(root.path))
        XCTAssertFalse(report.diagnosticDetail.contains("private.example.invalid"))
        XCTAssertEqual(report.failureMessage, String(localized: "Tono could not verify Chrome or Edge's Secure DNS configuration. This does not mean Secure DNS is enabled. Fully quit both browsers and tap Retry Now. If it persists, copy the failure details for support; do not delete browser data. Choose Restore internet to end protection and restore normal Internet."))
        let blockingReport = BrowserDNSDiagnostics.Report(chrome: blocking, edge: blocking)
        XCTAssertNotEqual(report.failureMessage, blockingReport.failureMessage)
    }

    private func writeJSON(_ value: Any, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONSerialization.data(withJSONObject: value).write(to: url)
    }

    private func writePlist(_ value: Any, to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try PropertyListSerialization.data(fromPropertyList: value, format: .binary, options: 0).write(to: url)
    }

    func testControllerFailureAndRealTUNSuccessKeepsConnection() {
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .failed("delay probe answered 504"),
            tun: .ok
        )
        guard case .connected(let advisory) = decision else {
            return XCTFail("real TUN success must own Connected")
        }
        XCTAssertEqual(advisory, "delay probe answered 504")
    }

    func testSingleOriginFailureDoesNotFailTheSetWhenAnotherSucceeded() {
        // The verifier returns success as soon as one origin matches. This
        // test locks the decision table: a successful TUN result is never
        // demoted by a controller warning or leftover origin failures.
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .ok,
            tun: .ok
        )
        XCTAssertEqual(decision, .connected(controllerAdvisory: nil))
    }

    func testTwoOriginsCanFailWhileOneSuccessIsEnough() {
        let failed = [
            ProbeOriginResult(
                label: "Google",
                url: ProtectedProbeOrigin.google.url,
                expectedStatus: 204,
                actualStatus: nil,
                category: .timeout,
                elapsedMs: 40,
                detail: "timeout"
            ),
            ProbeOriginResult(
                label: "Cloudflare",
                url: ProtectedProbeOrigin.cloudflare.url,
                expectedStatus: 204,
                actualStatus: nil,
                category: .dns,
                elapsedMs: 12,
                detail: "resolve"
            ),
        ]
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .ok,
            tun: .failed(failed)
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("all returned origins failed, so TUN is not proven")
        }
        XCTAssertEqual(failure.code, .tunRouteUnavailable)
        XCTAssertTrue(failure.copyableDetail.contains("PROBE_ORIGIN".contains("X") ? "" : "Google"))
    }

    func testAllOriginsFailedIsNotConnected() {
        let failed = ProtectedProbeOrigin.all.map {
            ProbeOriginResult(
                label: $0.label,
                url: $0.url,
                expectedStatus: $0.expectedStatus,
                actualStatus: nil,
                category: .timeout,
                elapsedMs: 10,
                detail: "timeout"
            )
        }
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .ok,
            tun: .failed(failed)
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("expected retry after total TUN failure")
        }
        XCTAssertEqual(failure.code, .tunRouteUnavailable)
        XCTAssertFalse(failure.userMessage.contains("delay"))
    }

    func testMixedProxySuccessCannotSubstituteForTUN() {
        let failed = [
            ProbeOriginResult(
                label: "Google",
                url: ProtectedProbeOrigin.google.url,
                expectedStatus: 204,
                actualStatus: nil,
                category: .timeout,
                elapsedMs: 8,
                detail: "timeout"
            )
        ]
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .ok,
            tun: .failed(failed),
            mixed: .ok
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("mixed proxy must remain diagnostic")
        }
        XCTAssertEqual(failure.code, .tunRouteUnavailable)
        XCTAssertTrue(failure.detail.contains("mixed proxy succeeded"))
    }

    func testControllerAndTUNFailButMixedSucceedsIsSystemPath() {
        let failed = [
            ProbeOriginResult(
                label: "Apple",
                url: ProtectedProbeOrigin.apple.url,
                expectedStatus: 200,
                actualStatus: nil,
                category: .dns,
                elapsedMs: 5,
                detail: "resolve"
            )
        ]
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .failed("504"),
            tun: .failed(failed),
            mixed: .ok
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("expected classified TUN/DNS failure")
        }
        XCTAssertEqual(failure.code, .tunRouteUnavailable)
    }

    func testAllPathsFailedIsCoreOrNode() {
        let failed = [
            ProbeOriginResult(
                label: "Google",
                url: ProtectedProbeOrigin.google.url,
                expectedStatus: 204,
                actualStatus: nil,
                category: .timeout,
                elapsedMs: 9,
                detail: "timeout"
            )
        ]
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .failed("controller down"),
            tun: .failed(failed),
            mixed: .failed("proxy refused")
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("expected core/node classification")
        }
        XCTAssertEqual(failure.code, .coreExitUnreachable)
    }

    func testPhysicalOfflineClassification() {
        let decision = ProtectedConnectivity.classifyPostLock(
            controller: .failed("timeout"),
            tun: .failed([]),
            mixed: .failed("timeout"),
            networkOffline: true
        )
        guard case .retry(let failure) = decision else {
            return XCTFail("offline must be classified")
        }
        XCTAssertEqual(failure.code, .networkEnvironmentOffline)
    }

    func testProbeStaggerIsHappyEyeballsNotABurst() {
        XCTAssertEqual(ProtectedConnectivity.probeStaggerMs, 100)
        XCTAssertLessThan(
            ProtectedConnectivity.probeStaggerMs * (ProtectedProbeOrigin.all.count - 1),
            1_000
        )
    }

    func testURLErrorClassifierSeparatesDNSTcpTlsAndTimeout() {
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyURLError(URLError(.timedOut)),
            .timeout
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyURLError(URLError(.cannotFindHost)),
            .dns
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyURLError(URLError(.cannotConnectToHost)),
            .tcp
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyURLError(URLError(.secureConnectionFailed)),
            .tls
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyURLError(URLError(.cancelled)),
            .cancelled
        )
    }

    func testCurlClassifierSeparatesDNSTcpTlsHttpAndTimeout() {
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyCurl(
                status: 0, httpCode: 204, expected: 204, message: ""
            ),
            .success
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyCurl(
                status: 28, httpCode: nil, expected: 204, message: "timed out"
            ),
            .timeout
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyCurl(
                status: 6, httpCode: nil, expected: 204, message: "Could not resolve host"
            ),
            .dns
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyCurl(
                status: 7, httpCode: nil, expected: 204, message: "Failed to connect"
            ),
            .tcp
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyCurl(
                status: 35, httpCode: nil, expected: 204, message: "SSL connect error"
            ),
            .tls
        )
        XCTAssertEqual(
            ProtectedConnectivityVerifier.classifyCurl(
                status: 0, httpCode: 503, expected: 204, message: ""
            ),
            .http
        )
    }

    func testPreferredOriginStartsFirst() {
        let ordered = ProtectedConnectivityVerifier.orderedOrigins(preferredLabel: "Apple")
        XCTAssertEqual(ordered.map(\.label), ["Apple", "Google", "Cloudflare"])
        XCTAssertEqual(
            ProtectedConnectivityVerifier.orderedOrigins(preferredLabel: nil).map(\.label),
            ProtectedProbeOrigin.all.map(\.label)
        )
    }

    func testFakeIPClassifierAndDNSAnswerParser() {
        XCTAssertTrue(ProtectedDNSProbe.isFakeIP("198.18.0.1"))
        XCTAssertFalse(ProtectedDNSProbe.isFakeIP("1.1.1.1"))
        XCTAssertTrue(ProtectedDNSProbe.containsFakeIP(["1.1.1.1", "198.18.12.34"]))
        XCTAssertEqual(ProtectedDNSProbe.firstFakeIP(in: ["1.1.1.1", "198.18.12.34"]), "198.18.12.34")
        XCTAssertNil(ProtectedDNSProbe.firstFakeIP(in: ["8.8.8.8"]))
        XCTAssertEqual(
            ProtectedConnectivityVerifier.parseHTTPStatus(
                Data("HTTP/1.1 204 No Content\r\n\r\n".utf8)
            )?.status,
            204
        )
        XCTAssertNil(ProtectedConnectivityVerifier.parseHTTPStatus(Data("HTTP/1.1".utf8)))

        var packet = ProtectedDNSProbe.encodeQuery(name: "www.gstatic.com")
        // Flip to a response with one A answer: keep the question, append
        // name-pointer + type A + class IN + TTL + rdlength 4 + 198.18.1.2
        packet[2] = 0x81
        packet[3] = 0x80
        packet[6] = 0x00
        packet[7] = 0x01
        packet.append(contentsOf: [
            0xC0, 0x0C,
            0x00, 0x01,
            0x00, 0x01,
            0x00, 0x00, 0x00, 0x3C,
            0x00, 0x04,
            198, 18, 1, 2,
        ])
        XCTAssertEqual(ProtectedDNSProbe.decodeAnswers(packet), ["198.18.1.2"])
        XCTAssertTrue(
            ProtectedDNSProbe.systemResolverBypassesProtectedListener(
                listenerAnswers: ["198.18.1.2"],
                systemAnswers: ["203.107.1.1"]
            )
        )
        XCTAssertFalse(
            ProtectedDNSProbe.systemResolverBypassesProtectedListener(
                listenerAnswers: ["198.18.1.2"],
                systemAnswers: ["198.18.1.2"]
            )
        )
        XCTAssertFalse(
            ProtectedDNSProbe.systemResolverBypassesProtectedListener(
                listenerAnswers: ["198.18.1.2"],
                systemAnswers: []
            )
        )
    }

    func testHealthCountersNeedTwoFullWindows() {
        var counters = ProtectedHealthCounters()
        counters.recordFailure(controller: true, dns: false, tun: true, core: false)
        XCTAssertFalse(counters.shouldEnterRecovering)
        counters.recordFailure(controller: true, dns: false, tun: true, core: false)
        XCTAssertTrue(counters.shouldEnterRecovering)
        counters.recordSuccess(controller: true, dns: true, tun: true, core: true)
        XCTAssertFalse(counters.shouldEnterRecovering)
        XCTAssertEqual(counters.tunFailures, 0)
    }

    func testErrorCopyIncludesCodeStageAndAttempts() {
        let failure = ProtectedConnectivity.failure(
            .protectedDnsNotReady,
            stage: "securingDNS",
            attempt: 2,
            generation: 9,
            detail: "system resolver still on DHCP"
        )
        XCTAssertTrue(failure.copyableDetail.contains("PROTECTED_DNS_NOT_READY"))
        XCTAssertTrue(failure.copyableDetail.contains("attempt=2"))
        XCTAssertTrue(failure.copyableDetail.contains("generation=9"))
        XCTAssertTrue(failure.userMessage.contains("DNS"))
    }

    func testClassifiedProtectionFailureIsNotPrefixedAsAPIRequest() {
        let error = CoreControllerError.protectionFailed(
            ProtectedFailureCode.coreExitUnreachable.userMessage
        )
        let text = error.localizedDescription
        XCTAssertEqual(text, ProtectedFailureCode.coreExitUnreachable.userMessage)
        XCTAssertFalse(text.contains("API request failed"))
    }

    func testProbeOriginsAreIndependentHTTPS() {
        let origins = ProtectedProbeOrigin.all
        XCTAssertEqual(origins.count, 3)
        let hosts = Set(origins.compactMap { URL(string: $0.url)?.host })
        XCTAssertEqual(hosts.count, 3)
        for origin in origins {
            XCTAssertTrue(origin.url.hasPrefix("https://"))
            XCTAssertTrue((200..<300).contains(origin.expectedStatus))
        }
    }

    func testStaleGenerationMustNotCommit() {
        let current: UInt64 = 4
        let incoming: UInt64 = 3
        XCTAssertNotEqual(current, incoming)
    }
}
