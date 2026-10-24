import XCTest
@testable import TonoKit

final class AccountRestrictionTests: XCTestCase {
    func testExplicit401PlanStatusIsNotRefreshedIntoALogout() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: 1_900_000_000), refresh: "synthetic", binding: "account-a"))
        let transport = ScriptedTransport { request, _ in
            if request.path == "auth/refresh" { return json(401, .obj(("error", .obj(("code", "INVALID_REFRESH_TOKEN"))))) }
            return json(401, .obj(("error", .obj(("code", "PLAN_EXPIRED")))))
        }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: transport), tokens: tokens, cache: MemoryCache(),
                                     now: { Date(timeIntervalSince1970: 1_800_000_000) })
        do { _ = try await session.loadCatalog(); XCTFail("expired plan must be visible") }
        catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "PLAN_EXPIRED")
            XCTAssertFalse(AccountErrors.isSessionEnded(error))
        }
        XCTAssertEqual(transport.attempts.map(\.0.path), ["exit-catalog"])
        XCTAssertEqual(tokens.tokens?.binding, "account-a")
    }

    func testQuota403KeepsCredentialsAndReportsTheAccountReason() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: 1_900_000_000), refresh: "synthetic", binding: "account-a"))
        let cache = MemoryCache(CachedCatalog(body: SampleCatalog.body().serialized(), revision: 7, fetchedAt: Date(), owner: "account-a"))
        let transport = ScriptedTransport { _, _ in json(403, .obj(("error", .obj(("code", "QUOTA_EXHAUSTED"))))) }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: transport), tokens: tokens, cache: cache,
                                     now: { Date(timeIntervalSince1970: 1_800_000_000) })
        do { _ = try await session.loadCatalog(); XCTFail("quota exhaustion must not reuse a cached catalog") }
        catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "QUOTA_EXHAUSTED")
            XCTAssertFalse(AccountErrors.isSessionEnded(error))
        }
        XCTAssertEqual(tokens.tokens?.binding, "account-a")
        XCTAssertNotNil(cache.cached)
        XCTAssertEqual(transport.attempts.count, 1)
    }

}
