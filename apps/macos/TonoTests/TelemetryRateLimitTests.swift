import XCTest
@testable import Tono

@MainActor
final class TelemetryRateLimitTests: XCTestCase {
    func test429RetainsOutboxAndDefersRetryUntilItsDeadline() async throws {
        let name = "tono-rate-limit-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let body = Data("{}".utf8)
        TelemetryOutbox.enqueue(kind: "failure", body: body, defaults: defaults)
        var now = Date(timeIntervalSince1970: 1_000)
        var calls = 0
        await TelemetryOutbox.drain(defaults: defaults, now: { now }) { _, _ in
            calls += 1
            throw TonoAPIClient.APIError.server(status: 429, message: "Rate limited")
        }
        XCTAssertEqual(TelemetryOutbox.pending(defaults: defaults).count, 1, "429 is not a delivered report")
        await TelemetryOutbox.drain(defaults: defaults, now: { now }) { _, _ in calls += 1 }
        XCTAssertEqual(calls, 1, "do not retry before the fallback Retry-After deadline")
        now = now.addingTimeInterval(60)
        await TelemetryOutbox.drain(defaults: defaults, now: { now }) { _, sent in
            calls += 1
            XCTAssertEqual(sent, body)
        }
        XCTAssertEqual(calls, 2)
        XCTAssertTrue(TelemetryOutbox.pending(defaults: defaults).isEmpty)
    }

    func testNewAccountCodesRemainEntitlementRefusalsRatherThanExpiredCredentials() {
        XCTAssertTrue(TonoAPIClient.entitlementCodes.contains("PLAN_EXPIRED"))
        XCTAssertTrue(TonoAPIClient.entitlementCodes.contains("QUOTA_EXHAUSTED"))
        XCTAssertTrue(TonoAPIClient.entitlementCodes.contains("DEVICE_REAUTH_REQUIRED"))
        let plan = TonoAPIClient.APIError.entitlementBlocked(code: "PLAN_EXPIRED", message: nil)
        let quota = TonoAPIClient.APIError.entitlementBlocked(code: "QUOTA_EXHAUSTED", message: nil)
        let device = TonoAPIClient.APIError.entitlementBlocked(code: "DEVICE_REAUTH_REQUIRED", message: nil)
        XCTAssertNotEqual(plan.errorDescription, quota.errorDescription)
        XCTAssertNotEqual(device.errorDescription, plan.errorDescription)
        XCTAssertNotEqual(device, .unauthorized)
    }
}
