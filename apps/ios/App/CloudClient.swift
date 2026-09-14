import Foundation

private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

@MainActor
final class CloudClient {
    private let vault = KeychainVault()
    private let session: URLSession
    private(set) var credentials: CloudSession?
    private var epoch = UUID()
    private var refresh: Task<Void, Error>?
    private var needsPersistence = false

    init() {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.urlCache = nil
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 25
        config.timeoutIntervalForResource = 40
        session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
    }

    func restore() throws -> CloudSession? {
        guard let data = try vault.read("session") else { return nil }
        let value = try JSONDecoder().decode(CloudSession.self, from: data)
        credentials = value
        return value
    }

    func start(email: String) async throws -> EmailChallenge {
        try await decode("auth/email/start", body: [
            "email": email, "deviceName": "Tono for iOS", "installationId": try vault.installationID(),
        ], authorized: false)
    }

    func verify(challenge: String, code: String) async throws -> CloudSession {
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

    func upload(_ data: Data) async throws {
        let bytes = try await request("telemetry/windows", method: "POST", body: data)
        struct Receipt: Decodable { let id: String }
        let receipt = try JSONDecoder().decode(Receipt.self, from: bytes)
        guard !receipt.id.isEmpty else { throw Blocker.serviceUnavailable }
    }

    func signOut() throws {
        epoch = UUID()
        refresh?.cancel()
        refresh = nil
        // Delete first: failure must be visible rather than silently restoring next launch.
        try vault.remove("session")
        credentials = nil
        needsPersistence = false
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
        guard generation == epoch else { throw Blocker.sessionExpired }
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
