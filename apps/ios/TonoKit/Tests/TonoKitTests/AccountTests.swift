import Foundation
import XCTest
@testable import TonoKit

/// Scripted transport: answers by (path kind, API path) and records every attempt.
final class ScriptedTransport: APITransport, @unchecked Sendable {
    typealias Handler = (APIRequest, APIPath) throws -> HTTPResponse
    private let lock = NSLock()
    private var handler: Handler
    private(set) var attempts: [(APIRequest, APIPath)] = []

    init(_ handler: @escaping Handler) { self.handler = handler }

    func send(_ request: APIRequest, base: URL, via path: APIPath) async throws -> HTTPResponse {
        try record(request, path)(request, path)
    }

    private func record(_ request: APIRequest, _ path: APIPath) -> Handler {
        lock.lock(); defer { lock.unlock() }
        attempts.append((request, path))
        return handler
    }

    func header(_ name: String, attempt: Int) -> String? {
        lock.lock(); defer { lock.unlock() }
        return attempts[attempt].0.headers.first { $0.0 == name }?.1
    }
}

struct Unreachable: Error {}

final class MemoryTokens: TokenStore, @unchecked Sendable {
    var tokens: SessionTokens?
    init(_ t: SessionTokens?) { tokens = t }
    func loadTokens() -> SessionTokens? { tokens }
    func saveTokens(_ t: SessionTokens) throws { tokens = t }
    func clearTokens() { tokens = nil }
}

final class MemoryCache: CatalogCache, @unchecked Sendable {
    var cached: CachedCatalog?
    init(_ c: CachedCatalog? = nil) { cached = c }
    func loadCatalog() -> CachedCatalog? { cached }
    func saveCatalog(_ c: CachedCatalog) throws { cached = c }
    func clearCatalog() { cached = nil }
}

func json(_ status: Int, _ value: JSON) -> HTTPResponse { HTTPResponse(status: status, body: Data(value.serialized().utf8)) }

/// HS256-shaped token with the given expiry; the signature is never checked client-side.
func jwt(exp: TimeInterval) -> String {
    let payload = Data(#"{"exp":\#(Int(exp))}"#.utf8).base64EncodedString()
        .replacingOccurrences(of: "=", with: "").replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
    return "eyJhbGciOiJIUzI1NiJ9.\(payload).sig"
}

final class AccountTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testUnreachableSystemPathFallsBackToARelayAndReportsTheFailedPath() async throws {
        let transport = ScriptedTransport { _, path in
            if path == .systemDNS { throw Unreachable() }
            return json(202, .obj(("challengeId", "c-1")))
        }
        let api = ControlPlaneClient(clientVersion: "0.1.0", transport: transport)
        let session = AccountSession(api: api, tokens: MemoryTokens(nil), cache: MemoryCache())
        let challenge = try await session.startEmail("a@example.com", deviceName: "iPhone", installationID: "install-1")
        XCTAssertEqual(challenge, "c-1")
        XCTAssertEqual(transport.attempts.map(\.1.kind), ["system_dns", "relay"])
        XCTAssertEqual(transport.header("X-Tono-Path", attempt: 1), "relay")
        XCTAssertEqual(transport.header("X-Tono-Path-Failed", attempt: 1), "system_dns")
        XCTAssertEqual(transport.header("X-Tono-Client", attempt: 0), "ios/0.1.0")
    }

    func testAPIErrorIsFinalAndNotRetriedOnARelay() async {
        let transport = ScriptedTransport { _, _ in
            json(401, .obj(("error", .obj(("code", "INVALID_OR_EXPIRED_CODE"), ("message", "expired")))))
        }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: transport), tokens: MemoryTokens(nil), cache: MemoryCache())
        do {
            _ = try await session.verify(challengeID: "c", code: "123456")
            XCTFail("expected error")
        } catch let e as APIError {
            XCTAssertEqual(e.code, "INVALID_OR_EXPIRED_CODE")
        } catch { XCTFail("\(error)") }
        XCTAssertEqual(transport.attempts.count, 1)
    }

    func testEdgeFiveHundredWithoutAnAPIBodyTriesTheNextPath() async throws {
        let transport = ScriptedTransport { _, path in
            path == .systemDNS ? HTTPResponse(status: 522, body: Data("<html>".utf8)) : json(200, .obj(("ok", true)))
        }
        let api = ControlPlaneClient(clientVersion: "1", transport: transport)
        _ = try await api.get("me", bearer: "t")
        XCTAssertEqual(transport.attempts.count, 2)
    }

    func testExpiredAccessTokenIsRefreshedAndRotatedBeforeTheCatalogCall() async throws {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 60), refresh: "refresh-old-0123456789"))
        let fresh = jwt(exp: now.timeIntervalSince1970 + 86_400)
        let transport = ScriptedTransport { request, _ in
            if request.path == "auth/refresh" { return json(200, .obj(("accessToken", .string(fresh)), ("refreshToken", "refresh-new-0123456789"))) }
            XCTAssertTrue(request.headers.contains { $0.0 == "Authorization" && $0.1 == "Bearer \(fresh)" })
            return json(200, SampleCatalog.body())
        }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: transport), tokens: tokens,
                                     cache: MemoryCache(), now: { [now] in now })
        let loaded = try await session.loadCatalog()
        XCTAssertFalse(loaded.fromCache)
        XCTAssertEqual(tokens.tokens?.refresh, "refresh-new-0123456789")
        XCTAssertEqual(transport.attempts.map(\.0.path), ["auth/refresh", "exit-catalog"])
    }

    func testOlderCatalogRevisionIsRefusedAsRollback() async {
        let cache = MemoryCache(CachedCatalog(body: "{}", revision: 9, fetchedAt: now, owner: "login-a"))
        let transport = ScriptedTransport { _, _ in json(200, SampleCatalog.body(revision: 7)) }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: transport),
                                     tokens: MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 9_999), refresh: "r", binding: "login-a")),
                                     cache: cache, now: { [now] in now })
        do {
            _ = try await session.loadCatalog()
            XCTFail("expected rollback refusal")
        } catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "CATALOG_ROLLBACK")
        }
        XCTAssertEqual(cache.cached?.revision, 9)
    }

    func testNetworkOutageReusesARecentCatalogButHomeUnavailableNeverDoes() async throws {
        let cachedBody = SampleCatalog.body().serialized()
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 9_999), refresh: "r", binding: "login-a"))
        let offline = ScriptedTransport { _, _ in throw Unreachable() }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: offline), tokens: tokens,
                                     cache: MemoryCache(CachedCatalog(body: cachedBody, revision: 7, fetchedAt: now.addingTimeInterval(-3600), owner: "login-a")),
                                     now: { [now] in now })
        let loaded = try await session.loadCatalog()
        XCTAssertTrue(loaded.fromCache)

        let homeDown = ScriptedTransport { _, _ in
            json(503, .obj(("error", .obj(("code", "CATALOG_UNAVAILABLE"), ("message", "Assigned home exit is unavailable")))))
        }
        let strict = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: homeDown), tokens: tokens,
                                    cache: MemoryCache(CachedCatalog(body: cachedBody, revision: 7, fetchedAt: now, owner: "login-a")), now: { [now] in now })
        do {
            _ = try await strict.loadCatalog()
            XCTFail("Home unavailability must not fall back to a cached Home")
        } catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "HOME_UNAVAILABLE")
        }
    }

    func testWeekOldCacheIsNotUsed() async {
        let offline = ScriptedTransport { _, _ in throw Unreachable() }
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: offline),
                                     tokens: MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 9_999), refresh: "r", binding: "login-a")),
                                     cache: MemoryCache(CachedCatalog(body: SampleCatalog.body().serialized(), revision: 7,
                                                                      fetchedAt: now.addingTimeInterval(-8 * 24 * 3600), owner: "login-a")),
                                     now: { [now] in now })
        do {
            _ = try await session.loadCatalog()
            XCTFail("expected NETWORK")
        } catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "NETWORK")
        }
    }

    func testSignOutClearsLocallyEvenWhenTheServerIsUnreachable() async {
        let tokens = MemoryTokens(SessionTokens(access: "a", refresh: "r"))
        let session = AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: ScriptedTransport { _, _ in throw Unreachable() }),
                                     tokens: tokens, cache: MemoryCache())
        await session.signOut()
        XCTAssertNil(tokens.tokens)
    }

    func testRelayResponseParserReadsChunkedAndSizedBodies() throws {
        let chunked = "HTTP/1.1 202 Accepted\r\nTransfer-Encoding: chunked\r\n\r\n5\r\n{\"a\":\r\n2\r\n1}\r\n0\r\n\r\n"
        XCTAssertEqual(try HTTP1.parse(Data(chunked.utf8)), HTTPResponse(status: 202, body: Data("{\"a\":1}".utf8)))
        let sized = "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 2\r\n\r\n{}extra"
        XCTAssertEqual(try HTTP1.parse(Data(sized.utf8)), HTTPResponse(status: 503, body: Data("{}".utf8)))
        XCTAssertThrowsError(try HTTP1.parse(Data("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort".utf8)))
    }

    func testRelayRequestCarriesTheAPIHostAndBasePath() {
        let request = APIRequest(method: "POST", path: "auth/refresh", body: Data("{}".utf8), headers: [("X-Tono-Path", "relay")])
        let text = String(decoding: HTTP1.serialize(request, base: ControlPlaneClient.productionBase), as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("POST /api/v1/auth/refresh HTTP/1.1\r\nHost: api.afk.ccwu.cc\r\n"))
        XCTAssertTrue(text.hasSuffix("Content-Length: 2\r\n\r\n{}"))
    }

    func testEmailShapeCheck() {
        XCTAssertTrue(AccountSession.isPlausibleEmail("ray@example.com"))
        XCTAssertFalse(AccountSession.isPlausibleEmail("ray@example"))
        XCTAssertFalse(AccountSession.isPlausibleEmail("ray example@x.io"))
    }

    /// Control-plane account-state contract (T6, 2026-10-24): plan expiry, used-up quota and a renewed
    /// plan that needs a fresh sign-in are 403s that keep the account, tokens and VPN configuration;
    /// only 401 credential failures end the session.
    func testAccountStateRefusalsDoNotEndTheSession() {
        for code in ["PLAN_EXPIRED", "QUOTA_EXHAUSTED", "DEVICE_REAUTH_REQUIRED"] {
            let error = APIError(status: 403, code: code, message: "")
            XCTAssertFalse(AccountErrors.isSessionEnded(error), code)
            XCTAssertEqual(AccountErrors.reasonCode(error), code)
        }
        XCTAssertTrue(AccountErrors.isSessionEnded(APIError(status: 401, code: "UNAUTHORIZED", message: "")))
    }

}
