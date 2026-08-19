import Darwin
import Foundation
import Network
import Security

/// Races independent HTTPS origins through the locked TUN.
///
/// System `URLSession` on a China Mac often ignores the protected resolver:
/// Encrypted DNS, a pre-connect cache, or Happy Eyeballs IPv6 will dial a
/// real/poisoned address. PF then drops the user-process packet and every
/// origin times out even when Reality is fine. Resolve each host on
/// `127.0.0.1:53`, require a fake-IP, and TLS to that address with the
/// original SNI. Mixed-proxy checks still use loopback CONNECT so they do
/// not depend on system DNS either.
nonisolated enum ProtectedConnectivityVerifier {
    static func raceSystemTUNProbes(
        timeoutSeconds: Int = 12,
        mixedProxyPort: Int? = nil,
        preferredLabel: String? = nil
    ) async -> OriginRace {
        let origins = orderedOrigins(preferredLabel: preferredLabel)
        return await withTaskGroup(of: ProbeOriginResult.self) { group in
            for (index, origin) in origins.enumerated() {
                group.addTask {
                    let stagger = ProtectedConnectivity.probeStaggerMs * index
                    if stagger > 0 {
                        try? await Task.sleep(for: .milliseconds(stagger))
                    }
                    if Task.isCancelled {
                        return ProbeOriginResult(
                            label: origin.label,
                            url: origin.url,
                            expectedStatus: origin.expectedStatus,
                            actualStatus: nil,
                            category: .cancelled,
                            elapsedMs: 0,
                            detail: "cancelled"
                        )
                    }
                    return await probe(
                        origin: origin,
                        timeoutSeconds: timeoutSeconds,
                        proxyPort: mixedProxyPort
                    )
                }
            }

            var failures: [ProbeOriginResult] = []
            for await result in group {
                if result.succeeded {
                    group.cancelAll()
                    return .won(result.label)
                }
                failures.append(result)
            }
            return .lost(failures)
        }
    }

    static func orderedOrigins(preferredLabel: String?) -> [ProtectedProbeOrigin] {
        guard let preferredLabel,
              let index = ProtectedProbeOrigin.all.firstIndex(where: { $0.label == preferredLabel })
        else {
            return ProtectedProbeOrigin.all
        }
        var origins = ProtectedProbeOrigin.all
        let preferred = origins.remove(at: index)
        origins.insert(preferred, at: 0)
        return origins
    }

    static func probe(
        origin: ProtectedProbeOrigin,
        timeoutSeconds: Int,
        proxyPort: Int?
    ) async -> ProbeOriginResult {
        let started = Date()
        guard let url = URL(string: origin.url),
              url.scheme?.lowercased() == "https",
              let host = url.host, !host.isEmpty else {
            return ProbeOriginResult(
                label: origin.label,
                url: origin.url,
                expectedStatus: origin.expectedStatus,
                actualStatus: nil,
                category: .unknown,
                elapsedMs: 0,
                detail: "invalid https origin"
            )
        }

        let timeout = TimeInterval(max(3, timeoutSeconds))
        let path = url.path.isEmpty ? "/" : url.path
        let outcome: (status: Int?, category: ProbeFailureCategory, detail: String)
        if let proxyPort {
            outcome = await httpsGetThroughMixedProxy(
                host: host,
                path: path,
                proxyPort: proxyPort,
                expectedStatus: origin.expectedStatus,
                timeout: timeout
            )
        } else {
            let answers = await ProtectedDNSProbe.queryListener(
                server: "127.0.0.1",
                port: 53,
                timeout: min(2, timeout),
                name: host
            )
            guard let fakeIP = ProtectedDNSProbe.firstFakeIP(in: answers) else {
                outcome = (
                    nil,
                    .dns,
                    "protected listener did not return a fake-ip for \(host); answers=\(answers.joined(separator: ","))"
                )
                let elapsed = max(0, Int(Date().timeIntervalSince(started) * 1_000))
                return ProbeOriginResult(
                    label: origin.label,
                    url: origin.url,
                    expectedStatus: origin.expectedStatus,
                    actualStatus: outcome.status,
                    category: outcome.category,
                    elapsedMs: elapsed,
                    detail: String(outcome.detail.prefix(200))
                )
            }
            outcome = await httpsGetToIPv4(
                host: host,
                path: path,
                ip: fakeIP,
                expectedStatus: origin.expectedStatus,
                timeout: timeout
            )
        }

        let elapsed = max(0, Int(Date().timeIntervalSince(started) * 1_000))
        return ProbeOriginResult(
            label: origin.label,
            url: origin.url,
            expectedStatus: origin.expectedStatus,
            actualStatus: outcome.status,
            category: outcome.category,
            elapsedMs: elapsed,
            detail: String(outcome.detail.prefix(200))
        )
    }

    static func httpsGetToIPv4(
        host: String,
        path: String,
        ip: String,
        expectedStatus: Int,
        timeout: TimeInterval
    ) async -> (status: Int?, category: ProbeFailureCategory, detail: String) {
        let tls = NWProtocolTLS.Options()
        host.withCString { name in
            sec_protocol_options_set_tls_server_name(
                tls.securityProtocolOptions,
                name
            )
        }
        let parameters = NWParameters(tls: tls, tcp: NWProtocolTCP.Options())
        parameters.preferNoProxies = true
        if let ipOptions = parameters.defaultProtocolStack.internetProtocol
            as? NWProtocolIP.Options {
            ipOptions.version = .v4
        }
        guard let port = NWEndpoint.Port("443") else {
            return (nil, .unknown, "invalid port")
        }
        let connection = NWConnection(
            host: NWEndpoint.Host(ip),
            port: port,
            using: parameters
        )
        let request = Data(
            "GET \(path) HTTP/1.1\r\nHost: \(host)\r\nConnection: close\r\nUser-Agent: Tono/0.0.68\r\nAccept: */*\r\n\r\n".utf8
        )
        let header = await transactHTTP(
            connection: connection,
            request: request,
            timeout: timeout
        )
        switch header {
        case .cancelled:
            return (nil, .cancelled, "cancelled")
        case .failed(let category, let detail):
            return (nil, category, detail)
        case .response(let status, let preamble):
            if status == expectedStatus {
                return (status, .success, "")
            }
            return (status, .http, preamble)
        }
    }

    static func httpsGetThroughMixedProxy(
        host: String,
        path: String,
        proxyPort: Int,
        expectedStatus: Int,
        timeout: TimeInterval
    ) async -> (status: Int?, category: ProbeFailureCategory, detail: String) {
        // CONNECT 200 means Mihomo opened TCP to the origin through the
        // selected exit. That is the mixed-path diagnostic; it does not
        // require a second TLS hop and does not ask the system resolver.
        _ = path
        guard let port = NWEndpoint.Port(rawValue: UInt16(clamping: max(1, proxyPort))) else {
            return (nil, .unknown, "invalid mixed port")
        }
        let parameters = NWParameters.tcp
        parameters.preferNoProxies = true
        let connection = NWConnection(
            host: NWEndpoint.Host("127.0.0.1"),
            port: port,
            using: parameters
        )
        let request = Data(
            "CONNECT \(host):443 HTTP/1.1\r\nHost: \(host):443\r\nProxy-Connection: keep-alive\r\n\r\n".utf8
        )
        let header = await transactHTTP(
            connection: connection,
            request: request,
            timeout: timeout
        )
        switch header {
        case .cancelled:
            return (nil, .cancelled, "cancelled")
        case .failed(let category, let detail):
            return (nil, category, detail)
        case .response(let status, let preamble):
            if status == 200 {
                return (expectedStatus, .success, "mixed connect 200")
            }
            return (status, .http, preamble)
        }
    }

    private enum HTTPHeaderResult {
        case cancelled
        case failed(ProbeFailureCategory, String)
        case response(Int, String)
    }

    private static func transactHTTP(
        connection: NWConnection,
        request: Data,
        timeout: TimeInterval
    ) async -> HTTPHeaderResult {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                let once = OnceResume<HTTPHeaderResult>()
                let finish: (HTTPHeaderResult) -> Void = { result in
                    if once.take(result) {
                        connection.cancel()
                        continuation.resume(returning: result)
                    }
                }
                connection.stateUpdateHandler = { state in
                    switch state {
                    case .ready:
                        connection.send(
                            content: request,
                            completion: .contentProcessed { error in
                                if let error {
                                    finish(.failed(classifyNWError(error), error.localizedDescription))
                                    return
                                }
                                receiveHTTPHeader(connection: connection, buffer: Data(), finish: finish)
                            }
                        )
                    case .failed(let error):
                        finish(.failed(classifyNWError(error), error.localizedDescription))
                    case .cancelled:
                        finish(.cancelled)
                    default:
                        break
                    }
                }
                connection.start(queue: DispatchQueue.global(qos: .userInitiated))
                DispatchQueue.global(qos: .userInitiated).asyncAfter(
                    deadline: .now() + max(1, timeout)
                ) {
                    finish(.failed(.timeout, "probe timed out"))
                }
            }
        } onCancel: {
            connection.cancel()
        }
    }

    private static func receiveHTTPHeader(
        connection: NWConnection,
        buffer: Data,
        finish: @escaping (HTTPHeaderResult) -> Void
    ) {
        if Task.isCancelled {
            finish(.cancelled)
            return
        }
        if let parsed = parseHTTPStatus(buffer) {
            finish(.response(parsed.status, parsed.line))
            return
        }
        if buffer.count > 4_096 {
            finish(.failed(.http, "response header too large"))
            return
        }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1_024) { data, _, isComplete, error in
            if let error {
                finish(.failed(classifyNWError(error), error.localizedDescription))
                return
            }
            var next = buffer
            if let data {
                next.append(data)
            }
            if let parsed = parseHTTPStatus(next) {
                finish(.response(parsed.status, parsed.line))
                return
            }
            if isComplete {
                finish(.failed(.http, "incomplete http response"))
                return
            }
            receiveHTTPHeader(connection: connection, buffer: next, finish: finish)
        }
    }

    static func parseHTTPStatus(_ data: Data) -> (status: Int, line: String)? {
        guard let text = String(data: data, encoding: .isoLatin1),
              let end = text.range(of: "\r\n") else {
            return nil
        }
        let line = String(text[..<end.lowerBound])
        let parts = line.split(separator: " ")
        guard parts.count >= 2, let status = Int(parts[1]) else {
            return nil
        }
        return (status, line)
    }

    static func classifyNWError(_ error: Error) -> ProbeFailureCategory {
        let posix = (error as NSError).code
        if posix == 60 || posix == ETIMEDOUT {
            return .timeout
        }
        if posix == ECONNREFUSED || posix == EHOSTUNREACH || posix == ENETUNREACH {
            return .tcp
        }
        return classifyURLError(error)
    }

    static func classifyURLError(_ error: Error) -> ProbeFailureCategory {
        let nsError = error as NSError
        let urlError = error as? URLError
            ?? URLError(URLError.Code(rawValue: nsError.code))
        switch urlError.code {
        case .cancelled:
            return .cancelled
        case .timedOut:
            return .timeout
        case .cannotFindHost, .dnsLookupFailed:
            return .dns
        case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet,
             .dataNotAllowed:
            return .tcp
        case .secureConnectionFailed, .serverCertificateHasBadDate,
             .serverCertificateUntrusted, .serverCertificateHasUnknownRoot,
             .serverCertificateNotYetValid, .clientCertificateRejected,
             .clientCertificateRequired,
             .appTransportSecurityRequiresSecureConnection:
            return .tls
        default:
            let message = error.localizedDescription
            if message.localizedCaseInsensitiveContains("timed out") {
                return .timeout
            }
            if message.localizedCaseInsensitiveContains("resolve") {
                return .dns
            }
            if message.localizedCaseInsensitiveContains("ssl")
                || message.localizedCaseInsensitiveContains("tls")
                || message.localizedCaseInsensitiveContains("certificate") {
                return .tls
            }
            if message.localizedCaseInsensitiveContains("connect") {
                return .tcp
            }
            return .unknown
        }
    }

    static func classifyCurl(
        status: Int32,
        httpCode: Int?,
        expected: Int,
        message: String
    ) -> ProbeFailureCategory {
        if status == 0, httpCode == expected {
            return .success
        }
        if status == 28 || message.localizedCaseInsensitiveContains("timed out") {
            return .timeout
        }
        if status == 6 || message.localizedCaseInsensitiveContains("resolve") {
            return .dns
        }
        if [35, 51, 52, 53, 54, 58, 60].contains(status)
            || message.localizedCaseInsensitiveContains("ssl")
            || message.localizedCaseInsensitiveContains("tls") {
            return .tls
        }
        if status == 7 || message.localizedCaseInsensitiveContains("connect") {
            return .tcp
        }
        if let httpCode, httpCode > 0 {
            return .http
        }
        return .unknown
    }
}

private final class OnceResume<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value?

    func take(_ next: Value) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard value == nil else { return false }
        value = next
        return true
    }
}
