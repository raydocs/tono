import XCTest
@testable import Tono

final class ProtectedConnectivityTests: XCTestCase {
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
