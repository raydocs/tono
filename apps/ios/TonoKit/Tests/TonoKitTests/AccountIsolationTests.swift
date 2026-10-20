import Foundation
import XCTest
@testable import TonoKit

/// One parked request: the transport holds it until the test opens the gate, so a test can act
/// (sign out, sign in) while the session actor is suspended on that request.
final class RequestGate: @unchecked Sendable {
    private let lock = NSLock()
    private var hasArrived = false
    private var isOpen = false
    private var arrivalWaiters: [CheckedContinuation<Void, Never>] = []
    private var openWaiters: [CheckedContinuation<Void, Never>] = []

    /// Transport side: report the request, then wait to be let through.
    func pass() async {
        lock.lock()
        hasArrived = true
        let arrivals = arrivalWaiters
        arrivalWaiters = []
        lock.unlock()
        arrivals.forEach { $0.resume() }
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            lock.lock()
            let through = isOpen
            if !through { openWaiters.append(c) }
            lock.unlock()
            if through { c.resume() }
        }
    }

    /// Returns once the held request has reached the transport.
    func arrived() async {
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            lock.lock()
            let done = hasArrived
            if !done { arrivalWaiters.append(c) }
            lock.unlock()
            if done { c.resume() }
        }
    }

    func open() {
        lock.lock()
        isOpen = true
        let waiters = openWaiters
        openWaiters = []
        lock.unlock()
        waiters.forEach { $0.resume() }
    }
}

/// Answers by API path; the first request to a held path waits on its gate first.
final class GatedTransport: APITransport, @unchecked Sendable {
    typealias Handler = @Sendable (APIRequest, APIPath) throws -> HTTPResponse
    private let lock = NSLock()
    private let handler: Handler
    private var gates: [String: RequestGate] = [:]
    private var log: [String] = []

    init(_ handler: @escaping Handler) { self.handler = handler }

    func hold(_ path: String) -> RequestGate {
        let gate = RequestGate()
        lock.lock(); defer { lock.unlock() }
        gates[path] = gate
        return gate
    }

    var paths: [String] {
        lock.lock(); defer { lock.unlock() }
        return log
    }

    func send(_ request: APIRequest, base: URL, via path: APIPath) async throws -> HTTPResponse {
        lock.lock()
        log.append(request.path)
        let gate = gates.removeValue(forKey: request.path)
        lock.unlock()
        if let gate { await gate.pass() }
        return try handler(request, path)
    }
}

/// A sign-in's requests stay its own: nothing that answers after a sign-out or a new sign-in may
/// write tokens or the catalog cache, and an offline fallback reuses only the same sign-in's copy.
/// All credential values are synthetic.
final class AccountIsolationTests: XCTestCase {
    let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func session(_ transport: APITransport, _ tokens: MemoryTokens, _ cache: MemoryCache) -> AccountSession {
        AccountSession(api: ControlPlaneClient(clientVersion: "1", transport: transport), tokens: tokens, cache: cache, now: { [now] in now })
    }

    /// Account A's server: rotates A's tokens, logs out, serves a catalog.
    private func serverA(_ access: String) -> GatedTransport {
        GatedTransport { request, _ in
            switch request.path {
            case "auth/refresh": return json(200, .obj(("accessToken", .string(access)), ("refreshToken", "refresh-a-1")))
            case "auth/logout": return json(200, .obj(("ok", true)))
            default: return json(200, SampleCatalog.body())
            }
        }
    }

    func testLocalSignOutDoesNotWaitForTheLogoutServer() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 86_400), refresh: "refresh-a", binding: "login-a"))
        let cache = MemoryCache()
        let transport = serverA(jwt(exp: now.timeIntervalSince1970 + 86_400))
        let gate = transport.hold("auth/logout")
        let account = session(transport, tokens, cache)

        await account.signOut(waitForServer: false)
        await gate.arrived()
        XCTAssertNil(tokens.loadTokens())
        XCTAssertNil(cache.loadCatalog())
        gate.open()
    }

    func testRefreshAnsweredAfterSignOutSavesNoTokens() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 60), refresh: "refresh-a-0", binding: "login-a"))
        let cache = MemoryCache()
        let transport = serverA(jwt(exp: now.timeIntervalSince1970 + 86_400))
        let gate = transport.hold("auth/refresh")
        let account = session(transport, tokens, cache)
        let load = Task { try await account.loadCatalog() }
        await gate.arrived()
        await account.signOut()
        gate.open()
        do {
            _ = try await load.value
            XCTFail("a refresh answered after sign-out must not produce a catalog")
        } catch {
            XCTAssertTrue(AccountErrors.isSuperseded(error), AccountErrors.reasonCode(error))
        }
        XCTAssertNil(tokens.tokens)
        XCTAssertNil(cache.cached)
        XCTAssertFalse(transport.paths.contains("exit-catalog"))
    }

    func testCatalogAnsweredAfterSignOutIsNeitherCachedNorReturned() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 86_400), refresh: "refresh-a-0", binding: "login-a"))
        let cache = MemoryCache()
        let transport = serverA(jwt(exp: now.timeIntervalSince1970 + 86_400))
        let gate = transport.hold("exit-catalog")
        let account = session(transport, tokens, cache)
        let load = Task { try await account.loadCatalog() }
        await gate.arrived()
        await account.signOut()
        gate.open()
        do {
            _ = try await load.value
            XCTFail("a catalog answered after sign-out must not be returned")
        } catch {
            XCTAssertTrue(AccountErrors.isSuperseded(error), AccountErrors.reasonCode(error))
        }
        XCTAssertNil(cache.cached)
        XCTAssertNil(tokens.tokens)
    }

    func testRefreshAnsweredAfterANewSignInCannotReplaceItsTokens() async throws {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 60), refresh: "refresh-a-0", binding: "login-a"))
        let cache = MemoryCache()
        let accessB = jwt(exp: now.timeIntervalSince1970 + 86_400)
        let transport = GatedTransport { request, _ in
            switch request.path {
            case "auth/refresh": return json(200, .obj(("accessToken", "access-a-1"), ("refreshToken", "refresh-a-1")))
            case "auth/email/verify":
                return json(200, .obj(("accessToken", .string(accessB)), ("refreshToken", "refresh-b-0"), ("user", .obj(("email", "b@example.com")))))
            default: return json(200, SampleCatalog.body())
            }
        }
        let gate = transport.hold("auth/refresh")
        let account = session(transport, tokens, cache)
        let load = Task { try await account.loadCatalog() }
        await gate.arrived()
        let email = try await account.verify(challengeID: "challenge-b", code: "000000")
        XCTAssertEqual(email, "b@example.com")
        gate.open()
        do {
            _ = try await load.value
            XCTFail("account A's refresh must not complete under account B")
        } catch {
            XCTAssertTrue(AccountErrors.isSuperseded(error), AccountErrors.reasonCode(error))
        }
        XCTAssertEqual(tokens.tokens?.refresh, "refresh-b-0")
        XCTAssertNotNil(tokens.tokens?.binding)
        XCTAssertNotEqual(tokens.tokens?.binding, "login-a")
        XCTAssertNil(cache.cached)
    }

    func testSignOutClearsTokensAndCatalogBeforeTheServerAnswers() async {
        let tokens = MemoryTokens(SessionTokens(access: "access-a-0", refresh: "refresh-a-0", binding: "login-a"))
        let cache = MemoryCache(CachedCatalog(body: SampleCatalog.body().serialized(), revision: 7, fetchedAt: now, owner: "login-a"))
        let transport = serverA("access-a-1")
        let gate = transport.hold("auth/logout")
        let account = session(transport, tokens, cache)
        let signOut = Task { await account.signOut() }
        await gate.arrived()
        XCTAssertNil(tokens.tokens)
        XCTAssertNil(cache.cached)
        gate.open()
        await signOut.value
    }

    func testOfflineFallbackRefusesACatalogCachedByAnotherSignIn() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 86_400), refresh: "refresh-b-0", binding: "login-b"))
        let cache = MemoryCache(CachedCatalog(body: SampleCatalog.body().serialized(), revision: 7, fetchedAt: now.addingTimeInterval(-3600), owner: "login-a"))
        let account = session(GatedTransport { _, _ in throw Unreachable() }, tokens, cache)
        do {
            _ = try await account.loadCatalog()
            XCTFail("account B must not fall back to account A's catalog")
        } catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "NETWORK")
        }
    }

    func testUpgradedSignInKeepsItsTokensButNotTheOwnerlessCatalog() async {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 86_400), refresh: "refresh-a-0"))
        let cache = MemoryCache(CachedCatalog(body: SampleCatalog.body().serialized(), revision: 7, fetchedAt: now.addingTimeInterval(-3600)))
        let account = session(GatedTransport { _, _ in throw Unreachable() }, tokens, cache)
        do {
            _ = try await account.loadCatalog()
            XCTFail("a catalog cached before owners existed must not be reused")
        } catch {
            XCTAssertEqual(AccountErrors.reasonCode(error), "NETWORK")
        }
        XCTAssertEqual(tokens.tokens?.refresh, "refresh-a-0")
        XCTAssertNotNil(tokens.tokens?.binding)
    }

    func testTokenRotationKeepsTheSignInsOwnCatalogUsable() async throws {
        let tokens = MemoryTokens(SessionTokens(access: jwt(exp: now.timeIntervalSince1970 + 60), refresh: "refresh-a-0", binding: "login-a"))
        let cache = MemoryCache(CachedCatalog(body: SampleCatalog.body().serialized(), revision: 7, fetchedAt: now.addingTimeInterval(-3600), owner: "login-a"))
        let fresh = jwt(exp: now.timeIntervalSince1970 + 86_400)
        let transport = GatedTransport { request, _ in
            guard request.path == "auth/refresh" else { throw Unreachable() }
            return json(200, .obj(("accessToken", .string(fresh)), ("refreshToken", "refresh-a-1")))
        }
        let loaded = try await session(transport, tokens, cache).loadCatalog()
        XCTAssertTrue(loaded.fromCache)
        XCTAssertEqual(tokens.tokens?.refresh, "refresh-a-1")
        XCTAssertEqual(tokens.tokens?.binding, "login-a")
    }
    func testANewerVerificationDisownsTheEarlierRequestBeforeEitherAnswer() async throws {
        let tokens = MemoryTokens(nil)
        let cache = MemoryCache()
        let transport = GatedTransport { request, _ in
            let body = try JSON.parse(request.body ?? Data())
            let who = body["challengeId"]?.string == "challenge-b" ? "b" : "a"
            return json(200, .obj(("accessToken", .string("access-" + who)),
                                  ("refreshToken", .string("refresh-" + who)),
                                  ("user", .obj(("email", .string(who + "@example.com"))))))
        }
        let account = session(transport, tokens, cache)
        let firstGate = transport.hold("auth/email/verify")
        let first = Task { try await account.verify(challengeID: "challenge-a", code: "000000") }
        await firstGate.arrived()
        let secondGate = transport.hold("auth/email/verify")
        let second = Task { try await account.verify(challengeID: "challenge-b", code: "000000") }
        await secondGate.arrived()
        firstGate.open()
        do {
            _ = try await first.value
            XCTFail("the earlier sign-in must not win merely because its answer arrives first")
        } catch {
            XCTAssertTrue(AccountErrors.isSuperseded(error))
        }
        XCTAssertNil(tokens.tokens)
        secondGate.open()
        let email = try await second.value
        XCTAssertEqual(email, "b@example.com")
        XCTAssertEqual(tokens.tokens?.refresh, "refresh-b")
    }

}
