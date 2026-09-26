import Foundation
#if canImport(Tonomobile)
import Tonomobile
#endif

private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class CloudClient {
    private let vault: any CredentialVault
    private let logoutIntent: any LogoutIntentStoring
    private let session: URLSession
    private(set) var credentials: CloudSession?
    var logoutPending: Bool { logoutIntent.processBlocked }
    private var epoch = UUID()
    private var refresh: Task<Void, Error>?
    private var needsPersistence = false

    init(vault: (any CredentialVault)? = nil, configuration: URLSessionConfiguration = .ephemeral,
         logoutIntent: (any LogoutIntentStoring)? = nil) {
        self.vault = vault ?? KeychainVault()
        self.logoutIntent = logoutIntent ?? LogoutIntentStore()
        let config = configuration
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 40
        session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }

    func restore() throws -> CloudSession? {
        try requireNoPendingLogout()
        // A retry must not reload an older token pair after a rotated-token write failed.
        if let credentials { return credentials }
        guard let data = try vault.read("session") else { return nil }
        do {
            let value = try JSONDecoder().decode(CloudSession.self, from: data)
            credentials = value
            return value
        } catch is DecodingError { throw Blocker.savedSessionCorrupt }
    }

    func start(email: String) async throws -> EmailChallenge {
        try requireNoPendingLogout()
        return try await decode("auth/email/start", body: [
            "email": email, "deviceName": "Tono for iOS", "installationId": try vault.installationID(),
        ], authorized: false)
    }

    func verify(challenge: String, code: String) async throws -> CloudSession {
        try requireNoPendingLogout()
        let generation = epoch
        let result: AuthEnvelope = try await decode("auth/email/verify", body: [
            "challengeId": challenge, "code": code,
        ], authorized: false)
        guard generation == epoch else { throw Blocker.sessionExpired }
        credentials = result.auth
        needsPersistence = true
        try persist()
        return result.auth
    }

    func me() async throws -> CloudUser {
        let result: MeEnvelope = try await decode("me")
        return result.user
    }

    func devices() async throws -> [CloudDevice] {
        let result: DevicesEnvelope = try await decode("devices")
        return result.devices
    }

    func revoke(_ device: CloudDevice) async throws {
        guard UUID(uuidString: device.id) != nil, device.current != true,
              device.id != credentials?.device?.id else { throw Blocker.unsupportedPolicy }
        _ = try await request("devices/\(device.id)", method: "DELETE")
    }

    func catalog() async throws -> CatalogEnvelope { try await decode("exit-catalog") }
    func policy() async throws -> PolicyEnvelope { try await decode("traffic-policy") }

    func locations() async throws -> [String] {
        try SingBoxIdentity.requireEmbeddedCore()
        #if canImport(Tonomobile)
        let catalog = try await request("exit-catalog")
        let policy = try await request("traffic-policy")
        guard let credentials, let deviceID = credentials.device?.id else { throw Blocker.sessionExpired }
        let old = try TunnelVault().watermark(scope: credentials.user.id + ":" + deviceID)
        var error: NSError?
        let result: String? = TonomobileLocations(catalog, policy, old, &error)
        guard let result, error == nil else { throw Blocker.unsupportedPolicy }
        return try JSONDecoder().decode([String].self, from: Data(result.utf8))
        #else
        throw Blocker.coreUnavailable
        #endif
    }

    func stageTunnel(generation: UUID, selected: String) async throws {
        try SingBoxIdentity.requireEmbeddedCore()
        #if canImport(Tonomobile)
        let identity = try await me() // rotates app-only refresh token if needed
        let catalog = try await request("exit-catalog")
        let policy = try await request("traffic-policy")
        guard let credentials, identity.id == credentials.user.id,
              let deviceID = credentials.device?.id else { throw Blocker.sessionExpired }
        let grant = TunnelGrant(accountID: identity.id, deviceID: deviceID,
            accessToken: credentials.accessToken, selected: selected, generation: generation, issuedAt: .now)
        let old = try TunnelVault().watermark(scope: grant.scope)
        var error: NSError?
        guard TonomobilePrepare(catalog, policy, selected, old, &error) != nil, error == nil else {
            throw Blocker.unsupportedPolicy
        }
        // Preflight only. The extension independently refetches and persists receipts.
        try TunnelVault().write(JSONEncoder().encode(grant), account: "grant")
        #else
        throw Blocker.coreUnavailable
        #endif
    }

    func upload(_ data: Data) async throws {
        let bytes = try await request("telemetry/windows", method: "POST", body: data)
        struct Receipt: Decodable { let id: String }
        let receipt = try JSONDecoder().decode(Receipt.self, from: bytes)
        guard !receipt.id.isEmpty else { throw Blocker.serviceUnavailable }
    }

    func beginLogout() throws {
        // Record intent BEFORE deleting credentials or reporting a local logout.
        // If this write fails, callers must leave explicit sign-out retry reachable.
        if !(try logoutIntent.isPending()) { try logoutIntent.mark() }
        invalidateSession()
    }

    func invalidateTerminalSession() {
        // Terminal auth loss cannot depend on a successful filesystem operation.
        invalidateSession()
    }

    func needsLogoutCleanup() throws -> Bool {
        if try logoutIntent.isPending() || logoutPending {
            invalidateSession()
            return true
        }
        return false
    }

    private func requireNoPendingLogout() throws {
        if try needsLogoutCleanup() { throw Blocker.keychainUnavailable }
    }

    private func invalidateSession() {
        logoutIntent.processBlocked = true
        epoch = UUID()
        refresh?.cancel()
        refresh = nil
        credentials = nil
        needsPersistence = false
    }

    func finishPendingLogout(tunnelQuiesced: Bool) throws -> Bool {
        do {
            let durable = try logoutIntent.isPending()
            guard durable || logoutPending else { return false }
            invalidateSession()
            // Reuse durable intent. A retry must not require another successful write.
            if !durable { try logoutIntent.mark() }
        } catch {
            // With known in-process intent, attempt credential deletion even when
            // marker storage fails. Keep the fence and surface the persistence error.
            if logoutPending { try? vault.remove("session") }
            throw error
        }
        // Keep the marker across failures/relaunches; clear it only AFTER deletion.
        try vault.remove("session")
        guard tunnelQuiesced else { throw Blocker.tunnelUnavailable }
        try logoutIntent.clear()
        logoutIntent.processBlocked = false
        return true
    }

    private func persist() throws {
        guard let credentials else { throw Blocker.sessionExpired }
        try vault.write(JSONEncoder().encode(credentials), account: "session")
        needsPersistence = false
    }

    private func rotate() async throws {
        if let refresh { try await refresh.value; return }
        guard let old = credentials, let token = old.refreshToken else { throw Blocker.sessionExpired }
        let generation = epoch
        let task = Task { @MainActor in
            let pair: TokenPair = try await self.decode("auth/refresh", body: ["refreshToken": token], authorized: false)
            guard generation == self.epoch else { throw Blocker.sessionExpired }
            self.credentials = CloudSession(accessToken: pair.accessToken, refreshToken: pair.refreshToken,
                                            user: old.user, device: old.device)
            // Retain rotated token in memory if Keychain is temporarily unavailable.
            self.needsPersistence = true
            try self.persist()
        }
        refresh = task
        defer { if generation == epoch { refresh = nil } }
        try await task.value
    }

    private func decode<T: Decodable>(_ path: String, body: [String: String]? = nil,
                                      authorized: Bool = true) async throws -> T {
        let data = try body.map { try JSONEncoder().encode($0) }
        let response = try await request(path, method: body == nil ? "GET" : "POST", body: data, authorized: authorized)
        return try JSONDecoder().decode(T.self, from: response)
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil,
                         authorized: Bool = true, retried: Bool = false) async throws -> Data {
        guard !logoutPending else { throw Blocker.sessionExpired }
        let generation = epoch
        // Brand is ninx.app. The current account service origin is deliberately unchanged.
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "TonoAPIBaseURL") as? String,
              raw == "https://api.afk.ccwu.cc", let base = URL(string: raw + "/api/v1/") else {
            throw Blocker.serviceUnavailable
        }
        if authorized && needsPersistence { try persist() }
        var request = URLRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("hy2", forHTTPHeaderField: "X-Tono-Accept")
        if authorized {
            guard let token = credentials?.accessToken else { throw Blocker.sessionExpired }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (stream, response) = try await session.bytes(for: request)
        guard let response = response as? HTTPURLResponse else { throw Blocker.serviceUnavailable }
        var data = Data()
        for try await byte in stream {
            guard data.count < 10_485_760 else { throw Blocker.serviceUnavailable }
            data.append(byte)
        }
        guard generation == epoch, !logoutPending else { throw Blocker.sessionExpired }
        if response.statusCode == 401 && authorized && !retried {
            try await rotate()
            // Only replay reads. DELETE and telemetry POST require explicit user/next-window retry.
            guard method == "GET" else { throw Blocker.serviceUnavailable }
            return try await self.request(path, method: method, body: body, authorized: true, retried: true)
        }
        guard (200..<300).contains(response.statusCode) else {
            struct Failure: Decodable {
                struct Detail: Decodable { let code: String }
                let error: Detail
            }
            let code = (try? JSONDecoder().decode(Failure.self, from: data))?.error.code
            if code == "DEVICE_LIMIT" { throw Blocker.deviceLimit }
            if code == "INVALID_OR_EXPIRED_CODE" { throw Blocker.invalidCode }
            if response.statusCode == 401 || response.statusCode == 403 { throw Blocker.sessionExpired }
            throw Blocker.serviceUnavailable // never surface server bodies, URLs or tokens
        }
        return data
    }
}
