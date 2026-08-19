import Foundation

/// Races independent HTTPS origins through a fresh, no-proxy client that
/// uses system DNS. The first exact TLS-verified status wins; remaining
/// requests are cancelled. A single origin failure never fails the verdict.
enum ProtectedConnectivityVerifier {
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
        guard let url = URL(string: origin.url), url.scheme?.lowercased() == "https" else {
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
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = timeout
        configuration.timeoutIntervalForResource = timeout
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpShouldSetCookies = false
        configuration.httpMaximumConnectionsPerHost = 1
        if let proxyPort {
            configuration.connectionProxyDictionary = [
                kCFNetworkProxiesHTTPEnable: true,
                kCFNetworkProxiesHTTPProxy: "127.0.0.1",
                kCFNetworkProxiesHTTPPort: proxyPort,
                kCFNetworkProxiesHTTPSEnable: true,
                kCFNetworkProxiesHTTPSProxy: "127.0.0.1",
                kCFNetworkProxiesHTTPSPort: proxyPort,
            ]
        } else {
            configuration.connectionProxyDictionary = [
                kCFNetworkProxiesHTTPEnable: false,
                kCFNetworkProxiesHTTPSEnable: false,
                kCFNetworkProxiesSOCKSEnable: false,
            ]
        }

        let delegate = RedirectBlockingDelegate()
        let session = URLSession(
            configuration: configuration,
            delegate: delegate,
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Tono/0.0.68", forHTTPHeaderField: "User-Agent")

        let outcome: (status: Int?, category: ProbeFailureCategory, detail: String)
        do {
            let (_, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode
            if status == origin.expectedStatus {
                outcome = (status, .success, "")
            } else {
                outcome = (
                    status,
                    .http,
                    "status \(status.map(String.init) ?? "-")"
                )
            }
        } catch {
            if Task.isCancelled {
                outcome = (nil, .cancelled, "cancelled")
            } else {
                outcome = (nil, classifyURLError(error), error.localizedDescription)
            }
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

private final class RedirectBlockingDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
