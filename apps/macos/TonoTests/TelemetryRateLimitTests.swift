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
        // An open registration with no plan yet is not a disabled account.
        let noPlan = TonoAPIClient.APIError.entitlementBlocked(code: "ENTITLEMENT_REQUIRED", message: nil)
        let disabled = TonoAPIClient.APIError.entitlementBlocked(code: "USER_DISABLED", message: nil)
        XCTAssertNotEqual(noPlan.errorDescription, disabled.errorDescription)
    }
    func testRetryAfterPersistsAndDoesNotStarveTheIndependentP0Bucket() async throws {
        let name = "tono-rate-buckets-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        TelemetryOutbox.enqueue(kind: "diagnostics", body: Data("diagnostics".utf8), defaults: defaults)
        TelemetryOutbox.enqueue(kind: "p0", body: Data("p0".utf8), defaults: defaults)
        var now = Date(timeIntervalSince1970: 1_000)
        var p0Posts = 0
        await TelemetryOutbox.drain(defaults: defaults, now: { now }) { _, body in
            if body == Data("diagnostics".utf8) {
                throw TonoAPIClient.APIError.rateLimited(retryAfter: 120)
            }
            p0Posts += 1
        }
        XCTAssertEqual(p0Posts, 1)
        XCTAssertEqual(TelemetryOutbox.pending(defaults: defaults).map { $0["kind"] }, ["diagnostics"])
        let reopened = try XCTUnwrap(UserDefaults(suiteName: name))
        now = now.addingTimeInterval(119)
        await TelemetryOutbox.drain(defaults: reopened, now: { now }) { _, _ in XCTFail("retried before Retry-After") }
        now = now.addingTimeInterval(1)
        await TelemetryOutbox.drain(defaults: reopened, now: { now }) { _, _ in }
        XCTAssertTrue(TelemetryOutbox.pending(defaults: reopened).isEmpty)
    }

    func testPinnedResponseUsesTheFinalRetryAfterHeader() {
        let response = Data("HTTP/1.1 103 Early Hints\r\nRetry-After: 1\r\n\r\nHTTP/1.1 429 Too Many Requests\r\nRetry-After: 123\r\nContent-Length: 2\r\n\r\n{}".utf8)
        XCTAssertEqual(PinnedResponse.retryAfter(in: response), "123")
    }

}
