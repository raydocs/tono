import Foundation

public struct SessionTokens: Equatable, Sendable {
    public var access: String
    public var refresh: String
    /// Random, non-secret identifier of this sign-in (never derived from either token). It survives
    /// token rotation and is stamped on the catalog cache. Nil only for tokens saved before it
    /// existed; AccountSession assigns one on first use.
    public var binding: String?
    public init(access: String, refresh: String, binding: String? = nil) {
        self.access = access
        self.refresh = refresh
        self.binding = binding
    }
}

/// App-only credential storage (the Keychain on iOS). The tunnel extension never holds tokens.
public protocol TokenStore: AnyObject, Sendable {
    func loadTokens() -> SessionTokens?
    func saveTokens(_ tokens: SessionTokens) throws
    func clearTokens()
}

/// The last admitted catalog body and its acceptance time, kept so a network outage can reuse it.
public struct CachedCatalog: Equatable, Sendable {
    public var body: String
    public var revision: Int
    public var fetchedAt: Date
    /// The sign-in binding that admitted it. A copy with no owner (written before owners existed) or
    /// another owner is never reused, for fallback or as the rollback floor.
    public var owner: String?
    public init(body: String, revision: Int, fetchedAt: Date, owner: String? = nil) {
        self.body = body
        self.revision = revision
        self.fetchedAt = fetchedAt
        self.owner = owner
    }
}

public protocol CatalogCache: AnyObject, Sendable {
    func loadCatalog() -> CachedCatalog?
    func saveCatalog(_ cached: CachedCatalog) throws
    func clearCatalog()
}

public struct LoadedCatalog: Equatable, Sendable {
    public let catalog: ExitCatalog
    /// The raw body that was admitted; the extension re-admits it before building its config.
    public let body: String
    /// True when the network failed and a recent admitted copy is in use.
    public let fromCache: Bool

    public init(catalog: ExitCatalog, body: String, fromCache: Bool) {
        self.catalog = catalog
        self.body = body
        self.fromCache = fromCache
    }
}

/// The sign-in a request started under ended (sign-out or a new sign-in) before the request
/// finished. Its result was dropped without touching tokens or the cache; callers ignore it.
public struct SessionSuperseded: Error, Equatable, Sendable {
    public init() {}
}

public enum AccountErrors {
    /// T8/T6 contract: authentication rejection ends the session. Only explicit account-status
    /// codes preserve credentials/configuration; the server must distinguish those from auth.
    public static let sessionEnded: Set<String> = ["UNAUTHORIZED", "INVALID_REFRESH_TOKEN", "SIGNED_OUT", "ACCOUNT_SUSPENDED"]
    public static let restrictions: Set<String> = ["ACCOUNT_EXPIRED", "QUOTA_EXCEEDED", "PLAN_EXPIRED", "QUOTA_EXHAUSTED"]

    public static func isRestriction(_ error: APIError) -> Bool {
        (error.status == 401 || error.status == 403) && restrictions.contains(error.code)
    }

    public static func isSessionEnded(_ error: Error) -> Bool {
        guard let e = error as? APIError else { return false }
        return e.status == 401 && sessionEnded.contains(e.code)
    }

    public static func isSuperseded(_ error: Error) -> Bool { error is SessionSuperseded }

    /// The reason code the UI shows; same mapping as Android `TonoVpnService.errorCode`.
    public static func reasonCode(_ error: Error) -> String {
        switch error {
        case let e as APIError:
            if e.code == "ACCOUNT_EXPIRED" { return "PLAN_EXPIRED" }
            if e.code == "QUOTA_EXCEEDED" { return "QUOTA_EXHAUSTED" }
            if e.code == "CATALOG_UNAVAILABLE" { return "HOME_UNAVAILABLE" }
            if e.status == 429 { return "RATE_LIMITED" }
            if isSessionEnded(e) { return "SESSION_ENDED" }
            return e.code
        case let e as CatalogRejected:
            return e.code
        default:
            return "UNKNOWN"
        }
    }
}

/// The control plane's global sign-in mail state (`auth/methods`, decision 138). Never about one
/// address: the registration mode (false is invite-only), open registration paused because today's
/// new-address budget is spent, and a recent failure of the mail provider. Fields an older control
/// plane does not send read as false.
public struct EmailSignInStatus: Equatable, Sendable {
    public let publicSignup: Bool
    public let signupPaused: Bool
    public let deliveryDegraded: Bool
}

/// Email sign-in, token rotation and catalog fetch with rollback refusal.
///
/// The actor re-enters at every network await, so each request holds a lease on the sign-in it
/// started under. Sign-out and sign-in end the current sign-in before their first await; a request
/// whose lease ended may not write tokens or the cache or return a result (`SessionSuperseded`).
public actor AccountSession {
    public static let cacheMaxAge: TimeInterval = 7 * 24 * 3600

    let api: ControlPlaneClient
    let tokens: TokenStore
    let cache: CatalogCache
    let now: @Sendable () -> Date
    private var access: String?
    /// Bumped by every sign-out and sign-in.
    private var epoch: UInt64 = 0
    /// The one token refresh in flight for `epoch`; concurrent callers share it.
    private var refreshing: (id: UInt64, epoch: UInt64, task: Task<String, Error>)?
    private var refreshes: UInt64 = 0

    struct Lease: Sendable {
        let epoch: UInt64
        let binding: String
    }

    public init(api: ControlPlaneClient, tokens: TokenStore, cache: CatalogCache, now: @escaping @Sendable () -> Date = { Date() }) {
        self.api = api
        self.tokens = tokens
        self.cache = cache
        self.now = now
    }

    public var isSignedIn: Bool { tokens.loadTokens() != nil }

    public static func isPlausibleEmail(_ email: String) -> Bool {
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...64).contains(parts[0].count), !parts[0].contains(where: \.isWhitespace) else { return false }
        let domain = parts[1]
        guard !domain.contains(where: \.isWhitespace), let dot = domain.lastIndex(of: "."), dot != domain.startIndex else { return false }
        return domain[domain.index(after: dot)...].count >= 2
    }

    /// Starts an email challenge. The server answers 202 for any address; copy says "if this email is enabled".
    public func startEmail(_ email: String, deviceName: String, installationID: String) async throws -> String {
        let body = try await api.post("auth/email/start", .obj(
            ("email", .string(email)), ("deviceName", .string(deviceName)), ("installationId", .string(installationID))
        ))
        guard let challenge = body["challengeId"]?.string else {
            throw APIError(status: 500, code: "SERVER_ERROR", message: "missing challengeId")
        }
        return challenge
    }

    /// nil when the control plane cannot be read; the copy then stays conditional.
    public func emailSignInStatus() async -> EmailSignInStatus? {
        guard let methods = try? await api.get("auth/methods", bearer: nil), let email = methods["email"] else { return nil }
        return EmailSignInStatus(publicSignup: email["publicSignup"]?.bool ?? false,
                                 signupPaused: email["signupPaused"]?.bool ?? false,
                                 deliveryDegraded: email["deliveryDegraded"]?.bool ?? false)
    }

    /// Verifies the six-digit code and stores the tokens. Returns the account email the server reports.
    public func verify(challengeID: String, code: String) async throws -> String? {
        // A newer verification request owns the sign-in even before either server answer arrives.
        endSignIn()
        tokens.clearTokens()
        cache.clearCatalog()
        let started = epoch
        let body: JSON
        do {
            body = try await api.post("auth/email/verify", .obj(("challengeId", .string(challengeID)), ("code", .string(code))))
        } catch {
            guard epoch == started else { throw SessionSuperseded() }
            throw error
        }
        // A sign-out or another sign-in started meanwhile: this answer is for a flow that is over.
        guard epoch == started else { throw SessionSuperseded() }
        guard let a = body["accessToken"]?.string, let r = body["refreshToken"]?.string else {
            throw APIError(status: 500, code: "SERVER_ERROR", message: "missing tokens")
        }
        try tokens.saveTokens(SessionTokens(access: a, refresh: r, binding: UUID().uuidString))
        access = a
        return body["user"]?["email"]?.string
    }

    /// Best-effort server logout, then local removal. Local state is cleared, and every request in
    /// flight disowned, before the server call, so it holds even when that call fails or hangs.
    public func signOut(waitForServer: Bool = true) async {
        endSignIn()
        let saved = tokens.loadTokens()
        tokens.clearTokens()
        cache.clearCatalog()
        guard let saved else { return }
        let api = self.api
        let logout = Task {
            _ = try? await api.post("auth/logout", .obj(("refreshToken", .string(saved.refresh))), bearer: saved.access)
        }
        if waitForServer { await logout.value }
    }

    /// Ends the current sign-in for every request holding a lease on it.
    private func endSignIn() {
        epoch &+= 1
        refreshing?.task.cancel()
        refreshing = nil
        access = nil
    }

    /// A lease on the current sign-in. Tokens saved before bindings existed get one now; catalogs
    /// cached back then carry no owner and stay unused.
    func currentLease() throws -> Lease {
        guard let saved = tokens.loadTokens() else { throw APIError(status: 401, code: "SIGNED_OUT", message: "not signed in") }
        if let binding = saved.binding { return Lease(epoch: epoch, binding: binding) }
        let binding = UUID().uuidString
        try tokens.saveTokens(SessionTokens(access: saved.access, refresh: saved.refresh, binding: binding))
        return Lease(epoch: epoch, binding: binding)
    }

    /// Throws `SessionSuperseded` unless the lease's sign-in is still the current one.
    func check(_ lease: Lease) throws {
        guard lease.epoch == epoch, tokens.loadTokens()?.binding == lease.binding else { throw SessionSuperseded() }
    }

    func bearer(forceRefresh: Bool, lease: Lease) async throws -> String {
        try check(lease)
        guard let saved = tokens.loadTokens() else { throw APIError(status: 401, code: "SIGNED_OUT", message: "not signed in") }
        let cached = access ?? saved.access
        if !forceRefresh && !JWT.expiringSoon(cached, now: now()) { return cached }
        let flight: (id: UInt64, epoch: UInt64, task: Task<String, Error>)
        if let current = refreshing, current.epoch == lease.epoch {
            flight = current
        } else {
            refreshes &+= 1
            flight = (refreshes, lease.epoch, Task { try await self.rotate(saved, lease: lease) })
            refreshing = flight
        }
        let result = await flight.task.result
        if refreshing?.id == flight.id { refreshing = nil }
        try check(lease)
        return try result.get()
    }

    private func rotate(_ saved: SessionTokens, lease: Lease) async throws -> String {
        let body = try await api.post("auth/refresh", .obj(("refreshToken", .string(saved.refresh))))
        try check(lease)
        guard let a = body["accessToken"]?.string else { throw APIError(status: 500, code: "SERVER_ERROR", message: "no access token") }
        let rotated = body["refreshToken"]?.string ?? saved.refresh
        try tokens.saveTokens(SessionTokens(access: a, refresh: rotated, binding: lease.binding))
        access = a
        return a
    }

    public func authorized<T: Sendable>(_ op: @Sendable (String) async throws -> T) async throws -> T {
        try await authorized(lease: try currentLease(), op)
    }

    func authorized<T: Sendable>(lease: Lease, _ op: @Sendable (String) async throws -> T) async throws -> T {
        do {
            do {
                let token = try await bearer(forceRefresh: false, lease: lease)
                try check(lease)
                let result = try await op(token)
                try check(lease)
                return result
            } catch let e as APIError where e.status == 401 && !AccountErrors.isRestriction(e) && e.code != "INVALID_REFRESH_TOKEN" && e.code != "SIGNED_OUT" && e.code != "ACCOUNT_SUSPENDED" {
                try check(lease)
                let token = try await bearer(forceRefresh: true, lease: lease)
                try check(lease)
                let result = try await op(token)
                try check(lease)
                return result
            }
        } catch {
            // A failure that lands after its sign-in ended belongs to no one: not a session end, not
            // a reason to fall back to a cache.
            try check(lease)
            throw error
        }
    }

    /// This sign-in's own cached catalog; any other copy is ignored and replaced on the next admit.
    private func ownCache(_ lease: Lease) -> CachedCatalog? {
        guard let cached = cache.loadCatalog(), cached.owner == lease.binding else { return nil }
        return cached
    }

    /// Fetches and admits the catalog. Falls back to the last admitted copy only when the network
    /// failed and that copy is this sign-in's and under seven days old; Home unavailability and
    /// rollbacks never fall back.
    public func loadCatalog() async throws -> LoadedCatalog {
        let lease = try currentLease()
        do {
            let api = self.api
            // Returns only while the lease holds; nothing below awaits, so the writes are this sign-in's.
            let body = try await authorized(lease: lease) { token in try await api.get("exit-catalog", bearer: token) }
            try check(lease)
            let admitted = try CatalogAdmission.admit(body)
            if let cached = ownCache(lease), admitted.revision < cached.revision {
                throw CatalogRejected("CATALOG_ROLLBACK", "catalog revision went backwards")
            }
            let text = body.serialized()
            try cache.saveCatalog(CachedCatalog(body: text, revision: admitted.revision, fetchedAt: now(), owner: lease.binding))
            return LoadedCatalog(catalog: admitted, body: text, fromCache: false)
        } catch let e as APIError where e.code == "NETWORK" {
            try check(lease)
            guard let cached = ownCache(lease), now().timeIntervalSince(cached.fetchedAt) < Self.cacheMaxAge,
                  let catalog = try? CatalogAdmission.admit(JSON.parse(cached.body)) else { throw e }
            return LoadedCatalog(catalog: catalog, body: cached.body, fromCache: true)
        }
    }
}

public enum JWT {
    /// Access tokens are 24 h HS256 JWTs; refresh five minutes early. Malformed tokens count as expired.
    public static func expiringSoon(_ token: String, now: Date) -> Bool {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return true }
        var payload = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while payload.count % 4 != 0 { payload += "=" }
        guard let data = Data(base64Encoded: payload), let json = try? JSON.parse(data), case .number(let exp)? = json["exp"] else {
            return true
        }
        return exp - now.timeIntervalSince1970 < 300
    }
}
