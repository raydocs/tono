import XCTest
@testable import Tono

/// Real AppState verification/classification/publication with only network I/O
/// held. No helper, DNS/PF mutation, Internet request or device speed claim.
@MainActor
final class ProtectedConnectionTimingTests: XCTestCase {
    func testWinningTUNReturnsWhileFinalDiagnosticIsHeldAndCancelsIt() async {
        let app = AppState()
        let tun = HeldConnectionProbe()
        let mixed = HeldConnectionProbe()
        let controller = HeldConnectionProbe()
        let tunStarted = expectation(description: "TUN started")
        let mixedStarted = expectation(description: "diagnostic started")
        let mixedCancelled = expectation(description: "diagnostic cancelled")
        let mixedFinished = expectation(description: "late diagnostic released")
        let returned = expectation(description: "TUN success returned before diagnostic/controller")
        let advisory = Task {
            await controller.wait()
            return ProbeCheck.failed("held advisory")
        }
        var verdict: ConnectivityVerdict?
        let work = Task {
            verdict = await app.verifyProtectedConnection(
                controllerTask: advisory, mixedPort: 12345, generation: 0, rounds: 1,
                raceProbes: { timeout, proxyPort, _ in
                    if proxyPort != nil {
                        XCTAssertEqual(timeout, 8)
                        mixedStarted.fulfill()
                        await withTaskCancellationHandler { await mixed.wait() } onCancel: {
                            mixedCancelled.fulfill()
                        }
                        mixedFinished.fulfill()
                        return .lost([])
                    }
                    XCTAssertEqual(timeout, 12)
                    tunStarted.fulfill()
                    await tun.wait()
                    return .won("Apple")
                }
            )
            returned.fulfill()
        }
        await fulfillment(of: [tunStarted, mixedStarted], timeout: 1)
        let releasedAt = ContinuousClock.now
        tun.open()
        await fulfillment(of: [returned, mixedCancelled], timeout: 1)
        XCTAssertEqual(verdict, .connected(controllerAdvisory: nil))
        XCTAssertEqual(app.lastSuccessfulProbeOrigin, "Apple")
        XCTAssertTrue(advisory.isCancelled)
        print("G1 controlled TUN win: \(releasedAt.duration(to: .now)); diagnostic/controller still held")
        mixed.open()
        controller.open()
        await fulfillment(of: [mixedFinished], timeout: 1)
        await work.value
        _ = await advisory.value
    }

    func testFailedFinalTUNUsesAlreadyRunningDiagnosticWithoutGrantingConnected() async {
        let app = AppState()
        let tun = HeldConnectionProbe()
        let mixed = HeldConnectionProbe()
        let tunStarted = expectation(description: "final TUN started")
        let mixedStarted = expectation(description: "final diagnostic started before TUN completes")
        let mixedFinished = expectation(description: "diagnostic result available before TUN")
        let returned = expectation(description: "failed verdict available after TUN")
        var tunCalls = 0
        var mixedCalls = 0
        var verdict: ConnectivityVerdict?
        let work = Task {
            verdict = await app.verifyProtectedConnection(
                controller: .failed("controller held no success"), mixedPort: 12345, generation: 0, rounds: 2,
                raceProbes: { timeout, proxyPort, preferred in
                    if let proxyPort {
                        mixedCalls += 1
                        XCTAssertEqual(tunCalls, 2, "diagnostic belongs only to final round")
                        XCTAssertEqual(proxyPort, 12345)
                        XCTAssertEqual(timeout, 8)
                        XCTAssertNil(preferred)
                        mixedStarted.fulfill()
                        await mixed.wait()
                        mixedFinished.fulfill()
                        return .won("Cloudflare")
                    }
                    tunCalls += 1
                    XCTAssertEqual(timeout, 12)
                    if tunCalls == 2 {
                        tunStarted.fulfill()
                        await tun.wait()
                    }
                    return .lost([])
                }
            )
            returned.fulfill()
        }
        await fulfillment(of: [tunStarted, mixedStarted], timeout: 2)
        XCTAssertNil(verdict)
        // Asymmetric completion: the diagnostic finishes first. The previous
        // serial implementation cannot even start it while TUN is held.
        mixed.open()
        await fulfillment(of: [mixedFinished], timeout: 1)
        XCTAssertNil(verdict, "mixed success alone never grants Connected")
        let releasedAt = ContinuousClock.now
        tun.open()
        await fulfillment(of: [returned], timeout: 1)
        await work.value
        guard case .failed(let failure) = verdict else { return XCTFail("TUN failure must fail closed") }
        XCTAssertEqual(failure.attempt, 2)
        // Real physical-offline evidence retains priority over mixed diagnosis.
        if PhysicalNetworkReachability.shared.isPhysicallyOffline {
            XCTAssertEqual(failure.code, .networkEnvironmentOffline)
        } else {
            XCTAssertEqual(failure.code, .tunRouteUnavailable)
            XCTAssertTrue(failure.detail.contains("mixed proxy succeeded"))
            XCTAssertTrue(failure.detail.contains("controller held no success"))
        }
        XCTAssertNil(app.lastSuccessfulProbeOrigin)
        XCTAssertEqual(tunCalls, 2)
        XCTAssertEqual(mixedCalls, 1)
        print("G1 controlled failed final TUN: \(releasedAt.duration(to: .now)) after TUN release; diagnostic already complete (overlap, not serial sum)")
    }

    func testRetiredTUNCompletionCannotOverwriteNewOriginOrPublishTelemetry() async {
        let app = AppState()
        app.connectionCoordinator.protectionOperationGeneration = 301
        let held = HeldConnectionProbe()
        let started = expectation(description: "old TUN held")
        let work = Task {
            await app.verifyProtectedConnection(
                mixedPort: 12345, generation: 301, rounds: 1,
                raceProbes: { _, port, _ in
                    if port != nil { return .lost([]) }
                    started.fulfill()
                    await held.wait()
                    return .won("old-origin")
                }
            )
        }
        await fulfillment(of: [started], timeout: 1)
        app.connectionCoordinator.bumpGeneration()
        let next = await app.verifyProtectedConnection(
            mixedPort: 12345, generation: 302, rounds: 1,
            raceProbes: { _, port, _ in port == nil ? .won("new-origin") : .lost([]) }
        )
        XCTAssertEqual(next, .connected(controllerAdvisory: nil))
        let before = probeEvents(generation: 301)
        held.open()
        let result = await work.value
        guard case .failed(let failure) = result else { return XCTFail("retired TUN granted Connected") }
        XCTAssertEqual(failure.detail, "stale generation")
        XCTAssertEqual(app.lastSuccessfulProbeOrigin, "new-origin")
        XCTAssertEqual(probeEvents(generation: 301), before)
    }

    func testCancelledDiagnosticCompletionCannotPublishFailure() async {
        let app = AppState()
        app.connectionCoordinator.protectionOperationGeneration = 401
        let held = HeldConnectionProbe()
        let started = expectation(description: "diagnostic held after failed TUN")
        let cancelled = expectation(description: "caller cancellation reaches diagnostic")
        let work = Task {
            await app.verifyProtectedConnection(
                mixedPort: 12345, generation: 401, rounds: 1,
                raceProbes: { _, port, _ in
                    guard port != nil else { return .lost([]) }
                    started.fulfill()
                    await withTaskCancellationHandler { await held.wait() } onCancel: { cancelled.fulfill() }
                    return .won("mixed-not-TUN")
                }
            )
        }
        await fulfillment(of: [started], timeout: 1)
        let before = probeEvents(generation: 401)
        work.cancel()
        await fulfillment(of: [cancelled], timeout: 1)
        held.open()
        let result = await work.value
        guard case .failed(let failure) = result else { return XCTFail("cancelled caller granted Connected") }
        XCTAssertEqual(failure.detail, "cancelled")
        XCTAssertNil(app.lastSuccessfulProbeOrigin)
        XCTAssertEqual(probeEvents(generation: 401), before)
    }

    func testRetiredFinalDiagnosisCannotPublishFailure() async {
        let app = AppState()
        app.connectionCoordinator.protectionOperationGeneration = 501
        let held = HeldConnectionProbe()
        let mixedFinished = expectation(description: "final network races finished")
        let advisory = Task {
            await held.wait()
            return ProbeCheck.failed("old controller")
        }
        let work = Task {
            await app.verifyProtectedConnection(
                controllerTask: advisory, mixedPort: 12345, generation: 501, rounds: 1,
                raceProbes: { _, port, _ in
                    if port != nil { mixedFinished.fulfill() }
                    return .lost([])
                }
            )
        }
        await fulfillment(of: [mixedFinished], timeout: 1)
        // Both network races completed, but the controller still has no result.
        // Regardless of which continuation is scheduled next, retirement must
        // defeat the entire final diagnosis, not only a successful TUN result.
        app.connectionCoordinator.bumpGeneration()
        let before = probeEvents(generation: 501)
        held.open()
        let result = await work.value
        guard case .failed(let failure) = result else { return XCTFail("retired controller granted Connected") }
        XCTAssertEqual(failure.detail, "stale generation")
        XCTAssertEqual(probeEvents(generation: 501), before)
    }

    private func probeEvents(generation: Int64) -> Int {
        ConnectionTelemetryBuffer.shared.snapshot().events.filter {
            $0.kind == "probeResult" && $0.generation == generation
        }.count
    }
}

@MainActor
private final class HeldConnectionProbe {
    private var isOpen = false
    private var continuation: CheckedContinuation<Void, Never>?

    func wait() async {
        guard !isOpen else { return }
        await withCheckedContinuation { continuation = $0 }
    }

    func open() {
        isOpen = true
        continuation?.resume()
        continuation = nil
    }
}
