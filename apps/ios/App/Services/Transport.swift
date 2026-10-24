import Foundation
import Network
import TonoKit

/// Both paths use verified TLS to the API hostname. The system path resolves that hostname;
/// relay paths dial a relay address with the same SNI and system certificate verification.
/// Using the same stream exchange exposes the HTTP write boundary on both paths (URLSession
/// does not expose a reliable before-first-write event for deciding whether a POST can replay).
struct AppTransport: APITransport {
    static let timeout: TimeInterval = 12

    func send(_ request: APIRequest, base: URL, via path: APIPath) async throws -> HTTPResponse {
        request.transmission.preparing()
        switch path {
        case .systemDNS:
            guard let host = base.host else { throw HTTP1.Failure(message: "missing API host") }
            return try await relay(request, base: base, host: host, port: base.port ?? 443)
        case .relay(let host, let port):
            return try await relay(request, base: base, host: host, port: port)
        }
    }

    private func relay(_ request: APIRequest, base: URL, host: String, port: Int) async throws -> HTTPResponse {
        guard base.scheme == "https", let apiHost = base.host, let portValue = UInt16(exactly: port), let nwPort = NWEndpoint.Port(rawValue: portValue) else { throw HTTP1.Failure(message: "bad relay") }
        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_tls_server_name(tls.securityProtocolOptions, apiHost)
        sec_protocol_options_add_tls_application_protocol(tls.securityProtocolOptions, "http/1.1")
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = Int(Self.timeout)
        let exchange = RelayExchange(connection: NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: NWParameters(tls: tls, tcp: tcp)))
        let data = try await exchange.run(HTTP1.serialize(request, base: base), transmission: request.transmission, timeout: Self.timeout * 2)
        return try HTTP1.parse(data)
    }
}

/// One request/response over a relay TLS stream: send, then read until the server closes.
private final class RelayExchange: @unchecked Sendable {
    private let connection: NWConnection
    private let lock = NSLock()
    private var buffer = Data()
    private var continuation: CheckedContinuation<Data, Error>?
    private var sent = false

    init(connection: NWConnection) { self.connection = connection }

    func run(_ payload: Data, transmission: APITransmission, timeout: TimeInterval) async throws -> Data {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Data, Error>) in
                lock.lock(); continuation = c; lock.unlock()
                connection.stateUpdateHandler = { [self] state in
                    switch state {
                    case .ready:
                        lock.lock()
                        let canSend = continuation != nil && !sent
                        if canSend { sent = true; transmission.willWrite() }
                        lock.unlock()
                        guard canSend else { return }
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
