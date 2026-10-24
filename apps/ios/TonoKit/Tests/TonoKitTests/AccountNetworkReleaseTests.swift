import XCTest
@testable import TonoKit

final class AccountNetworkReleaseTests: XCTestCase {
    @MainActor
    func testAccountRestrictionDisarmsAndStopsWithoutDeletingConfigurationOrCredentials() async {
        let lifecycle = TunnelStartCoordinator()
        let system = AccountConfiguration()
        let tokens = MemoryTokens(SessionTokens(access: "synthetic", refresh: "synthetic", binding: "account-a"))
        let at = Date(timeIntervalSince1970: 1_800_000_000)
        let receipt = await AccountNetworkRelease.handle(APIError(status: 403, code: "ACCOUNT_EXPIRED", message: "expired"),
                                                        accountEpoch: 7, at: at) {
            try await lifecycle.exclusive {
                try await AccountNetworkRelease.checkedStop(disarm: { await system.disarmOnDemand() },
                                                            stop: { system.requestStop() })
            }
        }
        XCTAssertEqual(system.events, ["disarm", "stop"])
        XCTAssertFalse(system.onDemandEnabled)
        XCTAssertFalse(system.running)
        XCTAssertTrue(system.saved)
        XCTAssertEqual(tokens.tokens?.binding, "account-a")
        XCTAssertEqual(receipt?.source, "account")
        XCTAssertEqual(receipt?.accountEpoch, 7)
        XCTAssertEqual(receipt?.at, at)
        XCTAssertEqual(receipt?.releaseRequested, true)
        XCTAssertEqual(receipt?.releaseFailed, false)
        let failure = TunnelFailure(code: "PLAN_EXPIRED", message: "account rejected", at: at,
                                    source: receipt?.source, accountEpoch: receipt?.accountEpoch)
        XCTAssertEqual(TunnelFailure.decode(failure.encoded()), failure)
    }

    @MainActor
    func testLegacyRefreshRejectionAlsoReleasesNetworkWithoutDeletingConfiguration() async {
        let lifecycle = TunnelStartCoordinator()
        let system = AccountConfiguration()
        let receipt = await AccountNetworkRelease.handle(APIError(status: 401, code: "INVALID_REFRESH_TOKEN", message: "rejected"), accountEpoch: 8) {
            await lifecycle.stop(system)
        }
        XCTAssertEqual(system.events, ["disarm", "stop"])
        XCTAssertTrue(system.saved)
        XCTAssertEqual(receipt?.reason, "ACCOUNT_UNAVAILABLE")
    }

    @MainActor
    func testDisarmFailureIsVisibleAndNotReportedAsSuccessfulRelease() async {
        struct DisarmFailed: Error {}
        var stops = 0
        let receipt = await AccountNetworkRelease.handle(APIError(status: 403, code: "QUOTA_EXCEEDED", message: "quota"), accountEpoch: 9) {
            try await AccountNetworkRelease.checkedStop(disarm: { throw DisarmFailed() }, stop: { stops += 1 })
        }
        XCTAssertEqual(stops, 1)
        XCTAssertEqual(receipt?.reason, "ACCOUNT_RELEASE_FAILED")
        XCTAssertEqual(receipt?.source, "account")
        XCTAssertEqual(receipt?.releaseFailed, true)
    }

    @MainActor
    func testCanonicalQuotaCodeReleasesAndMapsToHumanCopyReason() async {
        var releases = 0
        let receipt = await AccountNetworkRelease.handle(APIError(status: 403, code: "QUOTA_EXCEEDED", message: "quota"), accountEpoch: 11) { releases += 1 }
        XCTAssertEqual(releases, 1)
        XCTAssertEqual(receipt?.reason, "QUOTA_EXHAUSTED")
        XCTAssertFalse(AccountErrors.isSessionEnded(APIError(status: 403, code: "QUOTA_EXCEEDED", message: "quota")))
    }

    @MainActor
    func testOrdinaryNetworkErrorDoesNotStopAnExistingTunnel() async {
        var releases = 0
        let receipt = await AccountNetworkRelease.handle(APIError.network("offline"), accountEpoch: 10) { releases += 1 }
        XCTAssertNil(receipt)
        XCTAssertEqual(releases, 0)
    }
}

@MainActor
private final class AccountConfiguration: TunnelLifecycleSteps {
    var saved = true
    var running = true
    var onDemandEnabled = true
    var events: [String] = []
    func refresh() async -> Bool { saved }
    func saveForStart() async throws { saved = true; onDemandEnabled = true }
    func reloadForStart() async throws {}
    func startTunnel() throws { running = true }
    func disarmOnDemand() async { events.append("disarm"); onDemandEnabled = false }
    func requestStop() { events.append("stop"); running = false }
    func stopTunnel() async { requestStop() }
    func removeConfiguration() async { events.append("remove"); saved = false }
}
