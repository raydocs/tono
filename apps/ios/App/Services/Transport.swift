import Foundation
import Network
import TonoKit

/// Carries control-plane requests. `system_dns` uses URLSession (system resolver, ATS, normal
/// certificate checks). `relay` opens TLS to a Tono relay address with SNI set to the API host and
/// the system trust check for that host, then speaks HTTP/1.1 (the relay forwards unterminated TLS).
struct AppTransport: APITransport {
    static let timeout: TimeInterval = 12

    func send(_ request: APIRequest, base: URL, via path: APIPath) async throws -> HTTPResponse {
        switch path {
        case .systemDNS: return try await system(request, base: base)
        case .relay(let host, let port): return try await relay(request, base: base, host: host, port: port)
        }
    }

    private func system(_ request: APIRequest, base: URL) async throws -> HTTPResponse {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = Self.timeout
        config.timeoutIntervalForResource = Self.timeout * 2
        config.waitsForConnectivity = false
        config.httpCookieStorage = nil
        config.urlCache = nil
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        var url = base
        for part in request.path.split(separator: "/") { url.appendPathComponent(String(part)) }
        var r = URLRequest(url: url)
        r.httpMethod = request.method
        r.httpBody = request.body
        for (k, v) in request.headers { r.setValue(v, forHTTPHeaderField: k) }
        let (data, response) = try await session.data(for: r)
        guard let http = response as? HTTPURLResponse else { throw HTTP1.Failure(message: "not HTTP") }
        return HTTPResponse(status: http.statusCode, body: data)
    }

    private func relay(_ request: APIRequest, base: URL, host: String, port: Int) async throws -> HTTPResponse {
        guard let apiHost = base.host, let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else { throw HTTP1.Failure(message: "bad relay") }
        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, apiHost)
        sec_protocol_options_add_tls_application_protocol(tls.securityProtocolOptions, "http/1.1")
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = Int(Self.timeout)
        let exchange = RelayExchange(connection: NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: NWParameters(tls: tls, tcp: tcp)))
        let data = try await exchange.run(HTTP1.serialize(request, base: base), timeout: Self.timeout * 2)
        return try HTTP1.parse(data)
    }
}

/// One request/response over a relay TLS stream: send, then read until the server closes.
private final class RelayExchange: @unchecked Sendable {
    private let connection: NWConnection
    private let lock = NSLock()
    private var buffer = Data()
    private var continuation: CheckedContinuation<Data, Error>?

    init(connection: NWConnection) { self.connection = connection }

    func run(_ payload: Data, timeout: TimeInterval) async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Data, Error>) in
                lock.lock(); continuation = c; lock.unlock()
                connection.stateUpdateHandler = { [self] state in
                    switch state {
                    case .ready:
                        connection.send(content: payload, completion: .contentProcessed { [self] error in
                            if let error { finish(.failure(error)) } else { receive() }
                        })
                    case .failed(let error), .waiting(let error):
                        finish(.failure(error))
                    case .cancelled:
                        finish(.failure(CancellationError()))
                    default:
                        break
                    }
                }
                connection.start(queue: .global(qos: .userInitiated))
                DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { [self] in
                    finish(.failure(HTTP1.Failure(message: "relay timed out")))
                }
            }
        } onCancel: {
            connection.cancel()
        }
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [self] chunk, _, complete, error in
            lock.lock()
            if let chunk { buffer.append(chunk) }
            let size = buffer.count, body = buffer
            lock.unlock()
            if size > HTTP1.maxBody + 64 * 1024 { return finish(.failure(HTTP1.Failure(message: "response too large"))) }
            if complete { return finish(.success(body)) }
            if let error { return finish(.failure(error)) }
            receive()
        }
    }

    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        let c = continuation
        continuation = nil
        lock.unlock()
        c?.resume(with: result)
        connection.cancel()
    }
}
