import Foundation

/// Error from the Tono control plane or the paths to it. `code` is stable and maps to copy.
public struct APIError: Error, Equatable, CustomStringConvertible {
    public let status: Int
    public let code: String
    public let message: String

    public init(status: Int, code: String, message: String) {
        self.status = status
        self.code = code
        self.message = message
    }

    public var description: String { "\(status) \(code): \(message)" }

    /// Every path failed before any API answer arrived.
    public static func network(_ message: String) -> APIError { APIError(status: 0, code: "NETWORK", message: message) }
}

/// How one attempt reaches the API (decision 077 path kinds, `services/control-plane/src/ops/contract/api-paths.ts`).
public enum APIPath: Equatable, Sendable {
    /// Normal HTTPS with the system resolver.
    case systemDNS
    /// A Tono relay that forwards unterminated TLS; the client still verifies the API certificate.
    case relay(host: String, port: Int)

    public var kind: String {
        switch self {
        case .systemDNS: return "system_dns"
        case .relay: return "relay"
        }
    }
}

/// Per-path write boundary. Unknown transports are conservative; a transport must call
/// preparing before connection setup, then willWrite BEFORE handing any HTTP bytes to the socket.
public final class APITransmission: @unchecked Sendable {
    private let lock = NSLock()
    private var written = true
    public init() {}
    public func preparing() { lock.lock(); written = false; lock.unlock() }
    public func willWrite() { lock.lock(); written = true; lock.unlock() }
    public var mayHaveBeenSent: Bool { lock.lock(); defer { lock.unlock() }; return written }
}

public struct APIRequest: Equatable, Sendable {
    public var transmission = APITransmission()
    public var method: String
    /// Path below the API base, e.g. "auth/email/start".
    public var path: String
    public var body: Data?
    public var headers: [(String, String)]

    public static func == (a: APIRequest, b: APIRequest) -> Bool {
        a.method == b.method && a.path == b.path && a.body == b.body && a.headers.elementsEqual(b.headers, by: { $0 == $1 })
    }
}

public struct HTTPResponse: Equatable, Sendable {
    public var status: Int
    public var body: Data
    public init(status: Int, body: Data) {
        self.status = status
        self.body = body
    }
}

/// Carries one request over one path using Network.framework TLS, with SNI and verification for
/// the API host. Transports report the first possible HTTP write through request.transmission;
/// failures after that boundary may have executed the request. HTTP answers of any status return.
public protocol APITransport: Sendable {
    func send(_ request: APIRequest, base: URL, via path: APIPath) async throws -> HTTPResponse
}

/// Minimal JSON client for the Tono control plane (client contract v1), shared shape with the
/// desktop and Android clients: system resolver first, then the Tono API relays.
public struct ControlPlaneClient: Sendable {
    /// Keep in step with services/control-plane/src/api-relays.ts.
    public static let apiRelays: [APIPath] = [
        .relay(host: "179.253.233.220", port: 2053),
        .relay(host: "179.255.154.17", port: 2053),
        .relay(host: "154.84.56.196", port: 2053),
    ]
    public static let productionBase = URL(string: "https://api.afk.ccwu.cc/api/v1/")!

    public let base: URL
    public let clientVersion: String
    public let transport: APITransport
    public let paths: [APIPath]

    public init(base: URL = ControlPlaneClient.productionBase, clientVersion: String, transport: APITransport,
                paths: [APIPath] = [.systemDNS] + ControlPlaneClient.apiRelays) {
        self.base = base
        self.clientVersion = clientVersion
        self.transport = transport
        self.paths = paths
    }

    /// Headers for one attempt. `X-Tono-Client: ios/<version>`: the Worker records only platforms it
    /// knows (macos|windows today) and reads any other value as absent, so this is safe to send.
    public func headers(path: APIPath, failed: [APIPath], bearer: String?, hasBody: Bool) -> [(String, String)] {
        var h: [(String, String)] = [
            ("Accept", "application/json"),
            ("User-Agent", "Tono-iOS/\(clientVersion)"),
            ("X-Tono-Client", "ios/\(clientVersion)"),
            ("X-Tono-Path", path.kind),
            ("X-Tono-Path-Failed", failed.map(\.kind).reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }.joined(separator: ",")),
        ]
        if let bearer { h.append(("Authorization", "Bearer \(bearer)")) }
        if hasBody { h.append(("Content-Type", "application/json")) }
        return h
    }

    public func get(_ path: String, bearer: String?) async throws -> JSON {
        try await call("GET", path, body: nil, bearer: bearer)
    }

    public func post(_ path: String, _ body: JSON?, bearer: String? = nil) async throws -> JSON {
        try await call("POST", path, body: body, bearer: bearer)
    }

    func call(_ method: String, _ path: String, body: JSON?, bearer: String?) async throws -> JSON {
        let payload = body.map { Data($0.serialized().utf8) }
        var failed: [APIPath] = []
        var lastNetwork = "Tono servers are unreachable"
        for route in paths {
            let request = APIRequest(method: method, path: path, body: payload,
                                     headers: headers(path: route, failed: failed, bearer: bearer, hasBody: payload != nil))
            let response: HTTPResponse
            do {
                response = try await transport.send(request, base: base, via: route)
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastNetwork = "\(route.kind): \(error)"
                failed.append(route)
                if method == "POST", request.transmission.mayHaveBeenSent { break }
                continue
            }
            let json = response.body.isEmpty ? nil : try? JSON.parse(response.body)
            if (200...299).contains(response.status) { return json ?? .object(JSONObject()) }
            let error = json?["error"]
            // A 5xx from the edge on one path is an unreachable path; API errors are final.
            if response.status >= 500 && error?.object == nil {
                lastNetwork = "HTTP \(response.status) via \(route.kind)"
                failed.append(route)
                if method == "POST" { break }
                continue
            }
            throw APIError(status: response.status, code: error?["code"]?.string ?? "HTTP_\(response.status)",
                           message: error?["message"]?.string ?? "request failed")
        }
        throw APIError.network(lastNetwork)
    }
}

// MARK: - HTTP/1.1 for the relay path

/// The relay path speaks HTTP/1.1 over a TLS stream the app opens itself.
public enum HTTP1 {
    public static let maxBody = 2 * 1024 * 1024

    public struct Failure: Error, Equatable {
        public let message: String
        public init(message: String) { self.message = message }
    }

    public static func serialize(_ request: APIRequest, base: URL) -> Data {
        let host = base.host ?? ""
        var basePath = base.path
        while basePath.hasSuffix("/") { basePath.removeLast() }
        var head = "\(request.method) \(basePath)/\(request.path) HTTP/1.1\r\nHost: \(host)\r\nConnection: close\r\n"
        for (k, v) in request.headers { head += "\(k): \(v)\r\n" }
        if let body = request.body { head += "Content-Length: \(body.count)\r\n" }
        head += "\r\n"
        var data = Data(head.utf8)
        if let body = request.body { data.append(body) }
        return data
    }

    /// Parses a complete response read until the server closed the stream.
    public static func parse(_ data: Data) throws -> HTTPResponse {
        let bytes = [UInt8](data)
        var pos = 0
        func line() throws -> String {
            var out: [UInt8] = []
            while true {
                guard pos < bytes.count else {
                    if out.isEmpty { throw Failure(message: "connection closed") }
                    break
                }
                let b = bytes[pos]
                pos += 1
                if b == 0x0A { break }
                if b != 0x0D { out.append(b) }
                if out.count > 16 * 1024 { throw Failure(message: "header too long") }
            }
            return String(decoding: out, as: UTF8.self)
        }
        let statusLine = try line().split(separator: " ")
        guard statusLine.count >= 2, statusLine[0].hasPrefix("HTTP/1."), let status = Int(statusLine[1]) else {
            throw Failure(message: "bad status line")
        }
        var headers: [String: String] = [:]
        while true {
            let h = try line()
            if h.isEmpty { break }
            if let colon = h.firstIndex(of: ":") {
                headers[h[..<colon].trimmingCharacters(in: .whitespaces).lowercased()] = h[h.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            }
        }
        if headers["transfer-encoding"]?.lowercased().contains("chunked") == true {
            var body: [UInt8] = []
            while true {
                let sizeText = try line().split(separator: ";", maxSplits: 1).first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
                guard let size = Int(sizeText, radix: 16), size >= 0 else { throw Failure(message: "bad chunk size") }
                if size == 0 { break }
                guard body.count + size <= maxBody else { throw Failure(message: "response too large") }
                guard pos + size <= bytes.count else { throw Failure(message: "truncated chunk") }
                body.append(contentsOf: bytes[pos..<pos + size])
                pos += size
                _ = try line()
            }
            return HTTPResponse(status: status, body: Data(body))
        }
        if let lengthText = headers["content-length"] {
            guard let length = Int(lengthText), length >= 0, length <= maxBody else { throw Failure(message: "bad content-length") }
            guard pos + length <= bytes.count else { throw Failure(message: "truncated body") }
            return HTTPResponse(status: status, body: Data(bytes[pos..<pos + length]))
        }
        guard bytes.count - pos <= maxBody else { throw Failure(message: "response too large") }
        return HTTPResponse(status: status, body: Data(bytes[pos...]))
    }
}
