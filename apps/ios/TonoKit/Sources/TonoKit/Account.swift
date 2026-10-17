import Foundation

public struct SessionTokens: Equatable, Sendable {
    public var access: String
    public var refresh: String
    public init(access: String, refresh: String) {
        self.access = access
        self.refresh = refresh
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
    public init(body: String, revision: Int, fetchedAt: Date) {
        self.body = body
        self.revision = revision
        self.fetchedAt = fetchedAt
    }
}

public protocol CatalogCache: AnyObject, Sendable {
    func loadCatalog() -> CachedCatalog?
    func saveCatalog(_ cached: CachedCatalog) throws
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

public enum AccountErrors {
    /// Codes that mean this phone's session is over; the account is cleared locally.
    public static let sessionEnded: Set<String> = ["INVALID_REFRESH_TOKEN", "SIGNED_OUT", "UNAUTHORIZED", "ACCOUNT_SUSPENDED"]

    public static func isSessionEnded(_ error: Error) -> Bool {
        guard let e = error as? APIError else { return false }
        return e.status == 401 && sessionEnded.contains(e.code)
    }

    /// The reason code the UI shows; same mapping as Android `TonoVpnService.errorCode`.
    public static func reasonCode(_ error: Error) -> String {
        switch error {
        case let e as APIError:
            if e.code == "CATALOG_UNAVAILABLE" { return "HOME_UNAVAILABLE" }
            if e.status == 429 { return "RATE_LIMITED" }
            return e.code
        case let e as CatalogRejected:
            return e.code
        default:
            return "UNKNOWN"
        }
    }
}

/// Email sign-in, token rotation and catalog fetch with rollback refusal.
public actor AccountSession {
    public static let cacheMaxAge: TimeInterval = 7 * 24 * 3600

    let api: ControlPlaneClient
    let tokens: TokenStore
    let cache: CatalogCache
    let now: @Sendable () -> Date
    private var access: String?

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

    /// Verifies the six-digit code and stores the tokens. Returns the account email the server reports.
    public func verify(challengeID: String, code: String) async throws -> String? {
        let body = try await api.post("auth/email/verify", .obj(("challengeId", .string(challengeID)), ("code", .string(code))))
        guard let a = body["accessToken"]?.string, let r = body["refreshToken"]?.string else {
            throw APIError(status: 500, code: "SERVER_ERROR", message: "missing tokens")
        }
        try tokens.saveTokens(SessionTokens(access: a, refresh: r))
        access = a
        return body["user"]?["email"]?.string
    }

    /// Best-effort server logout, then local removal. Local state is cleared even when the call fails.
    public func signOut() async {
        let saved = tokens.loadTokens()
        tokens.clearTokens()
        access = nil
        guard let saved else { return }
        _ = try? await api.post("auth/logout", .obj(("refreshToken", .string(saved.refresh))), bearer: saved.access)
    }

    func bearer(forceRefresh: Bool) async throws -> String {
        guard let saved = tokens.loadTokens() else { throw APIError(status: 401, code: "SIGNED_OUT", message: "not signed in") }
        let cached = access ?? saved.access
        if !forceRefresh && !JWT.expiringSoon(cached, now: now()) { return cached }
        let body = try await api.post("auth/refresh", .obj(("refreshToken", .string(saved.refresh))))
        guard let a = body["accessToken"]?.string else { throw APIError(status: 500, code: "SERVER_ERROR", message: "no access token") }
        let rotated = body["refreshToken"]?.string ?? saved.refresh
        try tokens.saveTokens(SessionTokens(access: a, refresh: rotated))
        access = a
        return a
    }

    public func authorized<T: Sendable>(_ op: @Sendable (String) async throws -> T) async throws -> T {
        do {
            return try await op(try await bearer(forceRefresh: false))
        } catch let e as APIError where e.status == 401 && e.code != "INVALID_REFRESH_TOKEN" && e.code != "SIGNED_OUT" {
            return try await op(try await bearer(forceRefresh: true))
        }
    }

    /// Fetches and admits the catalog. Falls back to the last admitted copy only when the network
    /// failed and that copy is under seven days old; Home unavailability and rollbacks never fall back.
    public func loadCatalog() async throws -> LoadedCatalog {
        let cached = cache.loadCatalog()
        do {
            let api = self.api
            let body = try await authorized { token in try await api.get("exit-catalog", bearer: token) }
            let admitted = try CatalogAdmission.admit(body)
            if let cached, admitted.revision < cached.revision {
                throw CatalogRejected("CATALOG_ROLLBACK", "catalog revision went backwards")
            }
            let text = body.serialized()
            try cache.saveCatalog(CachedCatalog(body: text, revision: admitted.revision, fetchedAt: now()))
            return LoadedCatalog(catalog: admitted, body: text, fromCache: false)
        } catch let e as APIError where e.code == "NETWORK" {
            guard let cached, now().timeIntervalSince(cached.fetchedAt) < Self.cacheMaxAge,
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
