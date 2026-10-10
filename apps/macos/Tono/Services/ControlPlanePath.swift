import Foundation
import Network
import Security

/// What one control-plane exchange returned once its status line arrived
/// (#584). Both paths hand `TonoAPIClient.sendData` this shape, so they
/// cannot drift in how an answer is read.
nonisolated struct ControlPlaneAnswer: Sendable {
    let status: Int
    /// What arrived, never more than the response cap.
    let body: Data
    /// Set when the body stopped short after the status line. The status is
    /// still the server's answer (#582).
    let bodyFailure: (any Error)?
}

/// A response over the cap, or one that is not HTTP. `sendData` reports it
/// as an invalid response; it is never a reason to try another path.
nonisolated enum ControlPlaneExchangeError: Error {
    case invalidResponse
}

/// A literal address and port the pinned client dials (#584); the TLS
/// server name is always the API host.
nonisolated struct ControlPlaneEndpoint: Sendable, Hashable {
    let address: String
    let port: UInt16

    var description: String { port == 443 ? address : "\(address):\(port)" }
}

/// One way to reach the control plane (#584): the bundled pinned addresses,
/// whatever the system resolver returns, or a Tono-owned relay outside
/// Cloudflare (decision 077).
nonisolated struct ControlPlanePath: Sendable {
    /// Named in audit events.
    let label: String
    /// Sends the request and returns the answer, capped at the given number
    /// of bytes. A thrown error means no status line arrived.
    let exchange: @Sendable (URLRequest, Int) async throws -> ControlPlaneAnswer
    /// Backlog A4 (D14-A, decision 079): whether a TCP connection and a TLS
    /// handshake for the API host complete over this path, sending no HTTP
    /// request and nothing that identifies the user or the device. Nil when
    /// the path cannot be probed; the pre-login probe then says nothing.
    var handshake: (@Sendable () async -> Bool)? = nil

    /// The system resolver, through the control-plane `URLSession`.
    nonisolated static func systemResolver(_ session: URLSession) -> ControlPlanePath {
        ControlPlanePath(label: "system_dns") { request, maximumResponseBytes in
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw ControlPlaneExchangeError.invalidResponse
            }
            let declared = http.value(forHTTPHeaderField: "Content-Length").flatMap(Int.init)
            if let declared, declared < 0 || declared > maximumResponseBytes {
                throw ControlPlaneExchangeError.invalidResponse
            }
            var data = Data()
            data.reserveCapacity(min(declared ?? 0, maximumResponseBytes))
            do {
                for try await byte in bytes {
                    guard data.count < maximumResponseBytes else {
                        throw ControlPlaneExchangeError.invalidResponse
                    }
                    data.append(byte)
                }
            } catch let error as ControlPlaneExchangeError {
                throw error
            } catch {
                return ControlPlaneAnswer(status: http.statusCode, body: data, bodyFailure: error)
            }
            return ControlPlaneAnswer(status: http.statusCode, body: data, bodyFailure: nil)
        }
    }

    /// The pinned addresses for `baseURL`'s host, or nil when it has none.
    ///
    /// The same set the helper's PF permits on TCP 443 for this host: the
    /// compiled `TonoAPIBootstrapAddresses`, then addresses learned through
    /// the protected resolver. Only the configured API host has pins, so a
    /// debug base URL or a test host never dials them.
    nonisolated static func pinnedAddresses(for baseURL: URL) -> ControlPlanePath? {
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https",
              components.port == nil || components.port == 443,
              let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        let addresses = (KillSwitchService.configuredBootstrapPins(for: [host])[host] ?? [])
            .filter { IPv4Address($0) != nil }
        guard !addresses.isEmpty else { return nil }
        let endpoints = addresses.map { ControlPlaneEndpoint(address: $0, port: 443) }
        var path = ControlPlanePath(label: "pinned") { request, maximumResponseBytes in
            try await PinnedControlPlaneExchange.send(
                request,
                label: "pinned",
                host: host,
                endpoints: endpoints,
                connectBudget: PinnedControlPlaneExchange.connectBudget,
                userAgent: userAgent,
                maximumResponseBytes: maximumResponseBytes
            )
        }
        path.handshake = { await ControlPlaneHandshake.reaches(endpoints, host: host) }
        return path
    }

    /// Backlog A4: the system path's handshake, to `baseURL`'s host on 443
    /// through the system resolver, or nil when the base URL is not an HTTPS
    /// origin on 443.
    nonisolated static func systemResolverHandshake(for baseURL: URL) -> (@Sendable () async -> Bool)? {
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https",
              components.port == nil || components.port == 443,
              let host = components.host?.lowercased(), !host.isEmpty else { return nil }
        // The host name itself as the endpoint: Network.framework resolves
        // it through the system resolver, as the control-plane session does.
        let endpoints = [ControlPlaneEndpoint(address: host, port: 443)]
        return { await ControlPlaneHandshake.reaches(endpoints, host: host) }
    }

    /// Tono-owned relays outside Cloudflare, per API host (decision 077,
    /// the Windows client's `bootstrap::API_RELAYS`). Each is an nginx
    /// `ssl_preread` listener that admits only this host's SNI and forwards
    /// the unterminated TLS session to the Cloudflare edge, so the client
    /// validates the same certificate it does on every other path. Decision
    /// 086 (H1-F5, Option A): while protection is armed without a tunnel the
    /// helper's PF permits only these endpoints for the control plane, so
    /// then they are the only path (`TonoAPIClient`); while connected PF
    /// permits none of them. The list is `ControlPlaneRelays`, compiled into
    /// the helper too. The same relays admit the release host's SNI, which
    /// the updater's metadata GETs use (backlog A2).
    static let apiRelays: [String: [ControlPlaneEndpoint]] = [
        "api.afk.ccwu.cc": relayEndpoints,
        "releases.afk.ccwu.cc": relayEndpoints,
    ]

    private static let relayEndpoints = ControlPlaneRelays.endpoints.map {
        ControlPlaneEndpoint(address: $0.address, port: $0.port)
    }

    /// The relays for `baseURL`'s host, or nil when it has none. Only the
    /// production API and release hosts have relays; a debug base URL never
    /// dials them.
    nonisolated static func relays(for baseURL: URL) -> ControlPlanePath? {
        guard let relay = relayEndpoints(for: baseURL) else { return nil }
        let host = relay.host
        let endpoints = relay.endpoints
        var path = ControlPlanePath(label: "relay") { request, maximumResponseBytes in
            try await PinnedControlPlaneExchange.send(
                request,
                label: "relay",
                host: host,
                endpoints: endpoints,
                connectBudget: PinnedControlPlaneExchange.relayConnectBudget,
                userAgent: userAgent,
                maximumResponseBytes: maximumResponseBytes
            )
        }
        path.handshake = { await ControlPlaneHandshake.reaches(endpoints, host: host) }
        return path
    }

    /// `baseURL`'s host and its relays, or nil when it has none: only an
    /// HTTPS origin on 443 for the production API or release host.
    nonisolated static func relayEndpoints(for baseURL: URL) -> (host: String, endpoints: [ControlPlaneEndpoint])? {
        guard let components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https",
              components.port == nil || components.port == 443,
              let host = components.host?.lowercased(), !host.isEmpty,
              let endpoints = apiRelays[host], !endpoints.isEmpty else { return nil }
        return (host, endpoints)
    }

    /// `User-Agent` for the pinned client, which has no `URLSession` to set it.
    static var userAgent: String {
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
        return "Tono/\(build)"
    }
}

/// Backlog A4 (D14-A, decision 079): the pre-login network self-check. A TCP
/// connection and a TLS handshake, nothing more: no HTTP request, so no
/// cookie, token, device or installation id and no `X-Tono-*` header. TLS
/// carries the API host as SNI and the certificate is checked by the default
/// trust evaluation against that name, as on `PinnedConnection`; one that is
/// not valid for the host fails the probe. No proxy (#587). No PF permit is
/// added for it: while protection is armed, a path PF blocks just fails here.
nonisolated enum ControlPlaneHandshake {
    /// One path's whole budget; its endpoints are tried in parallel.
    static let budget: TimeInterval = 5

    /// True when any of `endpoints` completes TCP and TLS for `host` within
    /// `budget`.
    static func reaches(_ endpoints: [ControlPlaneEndpoint], host: String) async -> Bool {
        await withTaskGroup(of: Bool.self) { group in
            for endpoint in endpoints {
                group.addTask { await HandshakeAttempt(endpoint: endpoint, host: host).run(budget: Self.budget) }
            }
            for await reached in group where reached {
                group.cancelAll()
                return true
            }
            return false
        }
    }
}

/// One handshake to one endpoint. The connection is closed as soon as TLS is
/// up, fails, or the budget is spent; not one application byte is sent.
nonisolated private final class HandshakeAttempt: @unchecked Sendable {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "app.tono.control-plane.handshake")
    private let lock = NSLock()
    // Guarded by `lock`.
    private var result: Bool?
    private var continuation: CheckedContinuation<Bool, Never>?

    init(endpoint: ControlPlaneEndpoint, host: String) {
        connection = PinnedTLS.connection(to: endpoint, host: host)
    }

    func run(budget: TimeInterval) async -> Bool {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                self.start(continuation, budget: budget)
            }
        } onCancel: {
            self.finish(false)
        }
    }

    private func start(_ continuation: CheckedContinuation<Bool, Never>, budget: TimeInterval) {
        lock.lock()
        if let early = result {
            // Cancelled before it started.
            lock.unlock()
            continuation.resume(returning: early)
            return
        }
        self.continuation = continuation
        lock.unlock()
        connection.stateUpdateHandler = { [self] state in
            switch state {
            case .ready: finish(true)
            case .failed: finish(false)
            case .cancelled: connection.stateUpdateHandler = nil
            default: break // `.waiting` keeps trying; the budget decides.
            }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + budget) { [self] in finish(false) }
    }

    private func finish(_ reached: Bool) {
        lock.lock()
        guard result == nil else {
            lock.unlock()
            return
        }
        result = reached
        let waiting = continuation
        continuation = nil
        lock.unlock()
        connection.cancel()
        waiting?.resume(returning: reached)
    }
}

/// A TLS connection to a literal address for `host`: the one set of
/// parameters every pinned, relay and handshake connection uses. SNI and the
/// name the default trust evaluation checks the certificate against are both
/// `host`; nothing overrides that evaluation. Only where TCP lands is pinned.
/// #587: no system proxy, like the control-plane session.
nonisolated enum PinnedTLS {
    static func connection(to endpoint: ControlPlaneEndpoint, host: String) -> NWConnection {
        let tls = NWProtocolTLS.Options()
        let options = tls.securityProtocolOptions
        host.withCString { sec_protocol_options_set_tls_server_name(options, $0) }
        sec_protocol_options_add_tls_application_protocol(options, "http/1.1")
        sec_protocol_options_set_min_tls_protocol_version(options, .TLSv12)
        let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        parameters.preferNoProxies = true
        return NWConnection(
            host: NWEndpoint.Host(endpoint.address),
            port: NWEndpoint.Port(rawValue: endpoint.port) ?? .https,
            using: parameters
        )
    }
}

/// HTTP/1.1 over one TLS connection to a pinned address (#584).
///
/// `URLSession` cannot dial a fixed address for a host name, so this is the
/// smallest client that can. Network.framework connects to the literal
/// address and TLS carries the real host name as SNI; the certificate is
/// checked by the default trust evaluation against that name, the pattern
/// `ProtectedConnectivityVerifier.httpsGetToIPv4` already uses. Nothing here
/// replaces or relaxes certificate validation: a certificate that is not
/// valid for the host fails the connection before a request byte is sent.
/// One request per connection (`Connection: close`), no proxy (#587), no
/// redirects (a 3xx is the answer, as with `TonoNoRedirectDelegate`), and
/// the same response cap as the system path.
nonisolated enum PinnedControlPlaneExchange {
    /// Connect budget, TCP and TLS, across all pinned addresses and split
    /// between them like the Windows client (#583). Dropped pins cost at most
    /// this, whether they are the fallback or, once preferred, stand in front
    /// of the system resolver.
    static let connectBudget: TimeInterval = 10
    /// Connect budget across the relays (decision 077), the last path: a
    /// dead relay must not stretch a failed sign-in much further. The
    /// Windows client gives its relays 4 s.
    static let relayConnectBudget: TimeInterval = 5
    /// One whole exchange, like the session's `timeoutIntervalForResource`.
    static let exchangeBudget: TimeInterval = 45

    static func send(
        _ request: URLRequest,
        label: String,
        host: String,
        endpoints: [ControlPlaneEndpoint],
        connectBudget: TimeInterval,
        userAgent: String,
        maximumResponseBytes: Int
    ) async throws -> ControlPlaneAnswer {
        guard let message = requestBytes(request, host: host, userAgent: userAgent) else {
            // Nothing was sent, so another path may still carry it.
            throw URLError(.cannotConnectToHost, userInfo: [
                NSLocalizedDescriptionKey: "\(label): the request could not be framed",
            ])
        }
        let started = Date()
        var failures: [String] = []
        var clockRejected = false
        var trustRejected = false
        for (index, endpoint) in endpoints.enumerated() {
            try Task.checkCancellation()
            let remaining = connectBudget - Date().timeIntervalSince(started)
            guard remaining > 0 else { break }
            let connection = PinnedConnection(
                endpoint: endpoint,
                host: host,
                label: label,
                message: message,
                maximumResponseBytes: maximumResponseBytes
            )
            switch await connection.run(
                connectBudget: remaining / Double(endpoints.count - index),
                exchangeBudget: exchangeBudget
            ) {
            case let .answered(answer):
                return answer
            case let .failedAfterConnect(error):
                // The request may have arrived: never re-sent to another pin.
                throw error
            case .tooLarge:
                throw ControlPlaneExchangeError.invalidResponse
            case .cancelled:
                throw CancellationError()
            case let .notConnected(detail):
                failures.append("\(endpoint.description) \(detail)")
            case let .clockRejected(detail):
                // #588: named as the clock by `TonoAPIClient`.
                clockRejected = true
                failures.append("\(endpoint.description) \(detail)")
            case let .trustRejected(detail):
                // H21-O-F8: named as interception by `TonoAPIClient`.
                trustRejected = true
                failures.append("\(endpoint.description) \(detail)")
            }
        }
        // No endpoint reached TLS, so no request byte left this Mac.
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: "\(label): " + (failures.isEmpty
                ? "connect budget spent" : failures.joined(separator: "; ")),
        ]
        // The code stays `cannotConnectToHost`, so the retry rule is unchanged.
        if trustRejected, !clockRejected { userInfo[NetworkInterception.evidenceKey] = true }
        throw URLError(clockRejected ? .serverCertificateHasBadDate : .cannotConnectToHost, userInfo: userInfo)
    }

    /// The request as HTTP/1.1 bytes, or nil when a header cannot be framed.
    static func requestBytes(_ request: URLRequest, host: String, userAgent: String) -> Data? {
        guard let url = request.url,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return nil
        }
        var target = components.percentEncodedPath
        if target.isEmpty { target = "/" }
        if let query = components.percentEncodedQuery { target += "?" + query }
        let method = request.httpMethod ?? "GET"
        // Framing and connection headers belong to this transport.
        let reserved: Set<String> = [
            "host", "content-length", "connection", "transfer-encoding",
            "accept-encoding", "te", "upgrade", "keep-alive",
        ]
        var head = "\(method) \(target) HTTP/1.1\r\nHost: \(host)\r\n"
        var hasUserAgent = false
        for (field, value) in (request.allHTTPHeaderFields ?? [:]).sorted(by: { $0.key < $1.key }) {
            let name = field.lowercased()
            if reserved.contains(name) { continue }
            let unsafe = (field + value).unicodeScalars.contains { $0 == "\r" || $0 == "\n" }
            guard !unsafe, !field.isEmpty, !field.contains(":") else { return nil }
            if name == "user-agent" { hasUserAgent = true }
            head += "\(field): \(value)\r\n"
        }
        if !hasUserAgent { head += "User-Agent: \(userAgent)\r\n" }
        if let body = request.httpBody {
            head += "Content-Length: \(body.count)\r\n"
        } else if method != "GET" && method != "HEAD" {
            head += "Content-Length: 0\r\n"
        }
        // A compressed body would reach the JSON decoder as it came.
        head += "Accept-Encoding: identity\r\nConnection: close\r\n\r\n"
        var message = Data(head.utf8)
        if let body = request.httpBody { message.append(body) }
        return message
    }
}

nonisolated private enum PinnedOutcome: Sendable {
    /// No TLS connection within the budget, or it failed first: no request
    /// byte was sent.
    case notConnected(String)
    /// #588: TLS failed on a certificate date, before any request byte was
    /// sent. The clock, not the address, is at fault.
    case clockRejected(String)
    /// H21-O-F8: no TLS connection, and the trust store refused a certificate
    /// on the way (issuer, chain or name). No request byte was sent.
    case trustRejected(String)
    /// The request may have reached the server and no status line came back.
    case failedAfterConnect(any Error)
    case answered(ControlPlaneAnswer)
    case tooLarge
    case cancelled
}

/// One pinned endpoint, one request.
nonisolated private final class PinnedConnection: @unchecked Sendable {
    private let connection: NWConnection
    private let label: String
    private let message: Data
    private let maximumResponseBytes: Int
    private let queue = DispatchQueue(label: "app.tono.control-plane.pinned")
    private let lock = NSLock()
    // Guarded by `lock`.
    private var outcome: PinnedOutcome?
    private var continuation: CheckedContinuation<PinnedOutcome, Never>?
    // Touched only on `queue`.
    private var connected = false
    private var lastWaiting: String?
    /// H21-O-F8: a TLS attempt met a certificate the trust store refused.
    private var refusedCertificate = false
    private var received = Data()

    init(
        endpoint: ControlPlaneEndpoint, host: String, label: String, message: Data, maximumResponseBytes: Int
    ) {
        connection = PinnedTLS.connection(to: endpoint, host: host)
        self.label = label
        self.message = message
        self.maximumResponseBytes = maximumResponseBytes
    }

    func run(connectBudget: TimeInterval, exchangeBudget: TimeInterval) async -> PinnedOutcome {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<PinnedOutcome, Never>) in
                self.start(continuation, connectBudget: connectBudget, exchangeBudget: exchangeBudget)
            }
        } onCancel: {
            // The parse state lives on `queue`.
            self.queue.async { self.finish(self.cancellation()) }
        }
    }

    private func start(
        _ continuation: CheckedContinuation<PinnedOutcome, Never>,
        connectBudget: TimeInterval,
        exchangeBudget: TimeInterval
    ) {
        lock.lock()
        if let early = outcome {
            // Cancelled before it started.
            lock.unlock()
            continuation.resume(returning: early)
            return
        }
        self.continuation = continuation
        lock.unlock()
        connection.stateUpdateHandler = { [self] state in handle(state) }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + connectBudget) { [self] in
            guard !connected else { return }
            finish(notConnected(lastWaiting ?? "no TLS connection within \(Int(connectBudget.rounded(.up))) s"))
        }
        queue.asyncAfter(deadline: .now() + exchangeBudget) { [self] in
            finish(ending(with: URLError(.timedOut)))
        }
    }

    /// No TLS connection: named as interception when a certificate was refused.
    private func notConnected(_ detail: String) -> PinnedOutcome {
        refusedCertificate ? .trustRejected(detail) : .notConnected(detail)
    }

    private var isFinished: Bool {
        lock.lock(); defer { lock.unlock() }
        return outcome != nil
    }

    private func finish(_ result: PinnedOutcome) {
        lock.lock()
        guard outcome == nil else {
            lock.unlock()
            return
        }
        outcome = result
        let waiting = continuation
        continuation = nil
        lock.unlock()
        connection.cancel()
        waiting?.resume(returning: result)
    }

    private func handle(_ state: NWConnection.State) {
        switch state {
        case .ready:
            guard !isFinished else { return }
            connected = true
            connection.send(content: message, completion: .contentProcessed { [self] error in
                if let error {
                    finish(.failedAfterConnect(URLError(.networkConnectionLost, userInfo: [
                        NSLocalizedDescriptionKey: "\(label) send: \(error)",
                    ])))
                    return
                }
                receive()
            })
        case let .waiting(error):
            // A certificate the clock cannot date will not pass on a retry.
            if !connected, CertificateClock.isDateFailure(error) {
                finish(.clockRejected("\(error)"))
                return
            }
            if !connected, NetworkInterception.isTrustFailure(error) { refusedCertificate = true }
            // Still trying; the connect budget decides.
            lastWaiting = "\(error)"
        case let .failed(error):
            if !connected, CertificateClock.isDateFailure(error) {
                finish(.clockRejected("\(error)"))
                return
            }
            if !connected, NetworkInterception.isTrustFailure(error) { refusedCertificate = true }
            finish(connected
                ? ending(with: URLError(.networkConnectionLost, userInfo: [
                    NSLocalizedDescriptionKey: "\(label): \(error)",
                ]))
                : notConnected("\(error)"))
        case .cancelled:
            connection.stateUpdateHandler = nil
        default:
            break
        }
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [self] data, _, isComplete, error in
            guard !isFinished else { return }
            if let data { received.append(data) }
            guard received.count <= maximumResponseBytes + PinnedResponse.headLimit else {
                finish(.tooLarge)
                return
            }
            switch PinnedResponse.interpret(
                received, atEnd: isComplete && error == nil, limit: maximumResponseBytes
            ) {
            case let .complete(status, body):
                finish(.answered(ControlPlaneAnswer(status: status, body: body, bodyFailure: nil)))
            case .tooLarge:
                finish(.tooLarge)
            case .malformedHead:
                finish(.failedAfterConnect(URLError(.badServerResponse)))
            case let .malformedBody(status, body):
                finish(.answered(ControlPlaneAnswer(
                    status: status, body: body, bodyFailure: URLError(.badServerResponse)
                )))
            case .incomplete:
                guard isComplete || error != nil else {
                    receive()
                    return
                }
                finish(ending(with: URLError(.networkConnectionLost, userInfo: [
                    NSLocalizedDescriptionKey: "\(label): the connection closed early"
                        + (error.map { " (\($0))" } ?? ""),
                ])))
            }
        }
    }

    /// A cancelled exchange keeps a status line that already arrived, so a
    /// refusal still reaches the session verdict (#582) as it does on the
    /// system path. Before one, it is only cancelled.
    private func cancellation() -> PinnedOutcome {
        if case let .answered(answer) = ending(with: CancellationError()) {
            return .answered(answer)
        }
        return .cancelled
    }

    /// The outcome when the exchange stops here with `error`. Once a status
    /// line has arrived it is the server's answer, whatever follows (#582).
    private func ending(with error: any Error) -> PinnedOutcome {
        guard connected else { return .notConnected(error.localizedDescription) }
        switch PinnedResponse.interpret(received, atEnd: false, limit: maximumResponseBytes) {
        case let .complete(status, body):
            return .answered(ControlPlaneAnswer(status: status, body: body, bodyFailure: nil))
        case let .incomplete(status?, body), let .malformedBody(status, body):
            return .answered(ControlPlaneAnswer(status: status, body: body, bodyFailure: error))
        case .incomplete(.none, _), .malformedHead:
            return .failedAfterConnect(error)
        case .tooLarge:
            return .tooLarge
        }
    }
}

/// Reads an HTTP/1.1 response from the bytes received so far. The update
/// package relay (`PackageResponseSink`) reads its head with the same parts.
nonisolated enum PinnedResponse {
    static let headLimit = 64 * 1024

    enum Reading {
        case incomplete(status: Int?, body: Data)
        case complete(status: Int, body: Data)
        case malformedHead
        case malformedBody(status: Int, body: Data)
        case tooLarge
    }

    static func interpret(_ received: Data, atEnd: Bool, limit: Int) -> Reading {
        let bytes = [UInt8](received)
        var start = 0
        while true {
            // The status is the server's answer as soon as its line is
            // complete (#582): a header block that never finishes, or fails
            // to parse, still surfaces as that status.
            guard let lineEnd = find([13, 10], in: bytes, from: start) else {
                return bytes.count - start > headLimit
                    ? .malformedHead : .incomplete(status: nil, body: Data())
            }
            guard let status = parseStatusLine(bytes[start..<lineEnd]) else { return .malformedHead }
            // An interim response such as 103 is not the answer; the final
            // one follows it.
            let interim = (100..<200).contains(status)
            let unreadable: Reading = interim ? .malformedHead : .malformedBody(status: status, body: Data())
            guard let headEnd = find([13, 10, 13, 10], in: bytes, from: lineEnd) else {
                return bytes.count - start > headLimit
                    ? unreadable : .incomplete(status: interim ? nil : status, body: Data())
            }
            guard headEnd - start <= headLimit,
                  let headers = parseHeaders(bytes[min(lineEnd + 2, headEnd)..<headEnd]) else {
                return unreadable
            }
            let bodyStart = headEnd + 4
            if interim {
                guard status != 101 else { return .malformedHead }
                start = bodyStart
                continue
            }
            return readBody(
                status: status, headers: headers,
                body: bytes[bodyStart...], atEnd: atEnd, limit: limit
            )
        }
    }

    static func parseStatusLine(_ bytes: ArraySlice<UInt8>) -> Int? {
        let parts = String(decoding: bytes, as: UTF8.self)
            .split(separator: " ", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count >= 2, parts[0].hasPrefix("HTTP/1."), parts[1].count == 3,
              parts[1].allSatisfy(\.isASCII), let status = Int(parts[1]),
              (100...599).contains(status) else { return nil }
        return status
    }

    static func parseHeaders(_ bytes: ArraySlice<UInt8>) -> [String: String]? {
        var headers: [String: String] = [:]
        guard !bytes.isEmpty else { return headers }
        for line in String(decoding: bytes, as: UTF8.self).components(separatedBy: "\r\n") {
            guard let colon = line.firstIndex(of: ":") else { return nil }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            guard !name.isEmpty else { return nil }
            headers[name] = headers[name].map { "\($0), \(value)" } ?? value
        }
        return headers
    }

    private static func readBody(
        status: Int, headers: [String: String], body: ArraySlice<UInt8>, atEnd: Bool, limit: Int
    ) -> Reading {
        if status == 204 || status == 304 { return .complete(status: status, body: Data()) }
        if let coding = headers["transfer-encoding"] {
            guard coding.lowercased().hasSuffix("chunked") else {
                return untilClose(status: status, body: body, atEnd: atEnd, limit: limit)
            }
            return chunked(status: status, body: Array(body), limit: limit)
        }
        if let declared = headers["content-length"] {
            guard let length = Int(declared), length >= 0 else {
                return .malformedBody(status: status, body: Data())
            }
            guard length <= limit else { return .tooLarge }
            guard body.count >= length else { return .incomplete(status: status, body: Data(body)) }
            return .complete(status: status, body: Data(body.prefix(length)))
        }
        return untilClose(status: status, body: body, atEnd: atEnd, limit: limit)
    }

    /// A body without framing runs to the end of the connection.
    private static func untilClose(
        status: Int, body: ArraySlice<UInt8>, atEnd: Bool, limit: Int
    ) -> Reading {
        guard body.count <= limit else { return .tooLarge }
        return atEnd
            ? .complete(status: status, body: Data(body))
            : .incomplete(status: status, body: Data(body))
    }

    private static func chunked(status: Int, body: [UInt8], limit: Int) -> Reading {
        var index = 0
        var decoded = Data()
        while true {
            guard let lineEnd = find([13, 10], in: body, from: index) else {
                return .incomplete(status: status, body: decoded)
            }
            let sizeLine = String(decoding: body[index..<lineEnd], as: UTF8.self)
            let sizeField = (sizeLine.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)
                .first ?? "").trimmingCharacters(in: .whitespaces)
            guard !sizeField.isEmpty, sizeField.count <= 16,
                  sizeField.allSatisfy(\.isHexDigit),
                  let size = Int(sizeField, radix: 16) else {
                return .malformedBody(status: status, body: decoded)
            }
            index = lineEnd + 2
            if size == 0 {
                // Trailer fields, if any, end at an empty line.
                while true {
                    guard let fieldEnd = find([13, 10], in: body, from: index) else {
                        return .incomplete(status: status, body: decoded)
                    }
                    if fieldEnd == index { return .complete(status: status, body: decoded) }
                    index = fieldEnd + 2
                }
            }
            guard size <= limit - decoded.count else { return .tooLarge }
            guard body.count - index >= size + 2 else {
                decoded.append(contentsOf: body[index..<min(body.count, index + size)])
                return .incomplete(status: status, body: decoded)
            }
            decoded.append(contentsOf: body[index..<(index + size)])
            index += size
            guard body[index] == 13, body[index + 1] == 10 else {
                return .malformedBody(status: status, body: decoded)
            }
            index += 2
        }
    }

    static func find(_ pattern: [UInt8], in bytes: [UInt8], from start: Int) -> Int? {
        var index = start
        while index + pattern.count <= bytes.count {
            if bytes[index..<(index + pattern.count)].elementsEqual(pattern) { return index }
            index += 1
        }
        return nil
    }
}
