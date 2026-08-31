import Foundation

/// Cross-platform protected-connection contract.
///
/// Controller `/delay` is advisory. Ordinary App HTTPS through system DNS and
/// the locked TUN owns the Connected verdict. Mixed-proxy success is
/// diagnostic only and never substitutes for a real TUN probe.
nonisolated enum ProtectedFailureCode: String, CaseIterable, Sendable {
    case probeOriginDegraded = "PROBE_ORIGIN_DEGRADED"
    case protectedDnsNotReady = "PROTECTED_DNS_NOT_READY"
    case tunRouteUnavailable = "TUN_ROUTE_UNAVAILABLE"
    case coreControllerUnavailable = "CORE_CONTROLLER_UNAVAILABLE"
    case coreExitUnreachable = "CORE_EXIT_UNREACHABLE"
    case networkEnvironmentOffline = "NETWORK_ENVIRONMENT_OFFLINE"
    case helperProtocolMismatch = "HELPER_PROTOCOL_MISMATCH"
    case updateRecoveryFailed = "UPDATE_RECOVERY_FAILED"
    case catalogNodeRemoved = "CATALOG_NODE_REMOVED"
    case unknownClassifiedFailure = "UNKNOWN_CLASSIFIED_FAILURE"

    var userMessage: String {
        switch self {
        case .probeOriginDegraded:
            return "个别探测来源暂时失败，受保护连接仍然可用。"
        case .protectedDnsNotReady:
            return "系统 DNS 尚未进入受保护路径，连接未能完成。"
        case .tunRouteUnavailable:
            return "受保护隧道已建立，但系统流量未能进入隧道。"
        case .coreControllerUnavailable:
            return "核心控制器暂时不可用。若真实流量正常，连接会保持。"
        case .coreExitUnreachable:
            return "当前节点和核心均无法完成受保护验证。"
        case .networkEnvironmentOffline:
            // Looked up rather than written in place: a physical-link
            // observation is what produces this code, and it reaches the
            // connection banner on a Mac running in either language.
            return String(
                localized: "This Mac has no network connection. Protection resumes automatically when the network returns."
            )
        case .helperProtocolMismatch:
            return "网络助手协议不匹配，需要先完成助手修复。"
        case .updateRecoveryFailed:
            return "更新后的受保护连接未能恢复。"
        case .catalogNodeRemoved:
            return "所选节点已从目录移除，正在改用可用节点。"
        case .unknownClassifiedFailure:
            return "受保护连接失败，已记录诊断信息。"
        }
    }
}

nonisolated enum ProbeFailureCategory: String, Sendable {
    case success
    case dns
    case tcp
    case tls
    case http
    case timeout
    case cancelled
    case unknown
}

nonisolated struct ProtectedProbeOrigin: Equatable, Sendable {
    let label: String
    let url: String
    let expectedStatus: Int

    static let google = ProtectedProbeOrigin(
        label: "Google",
        url: "https://www.gstatic.com/generate_204",
        expectedStatus: 204
    )
    static let cloudflare = ProtectedProbeOrigin(
        label: "Cloudflare",
        url: "https://cp.cloudflare.com/generate_204",
        expectedStatus: 204
    )
    static let apple = ProtectedProbeOrigin(
        label: "Apple",
        url: "https://www.apple.com/library/test/success.html",
        expectedStatus: 200
    )

    static let all: [ProtectedProbeOrigin] = [.google, .cloudflare, .apple]
}

nonisolated struct ProbeOriginResult: Equatable, Sendable {
    var label: String
    var url: String
    var expectedStatus: Int
    var actualStatus: Int?
    var category: ProbeFailureCategory
    var elapsedMs: Int
    var detail: String

    var succeeded: Bool {
        category == .success && actualStatus == expectedStatus
    }

    var redactedDetail: String {
        "\(label) status=\(actualStatus.map(String.init) ?? "-") category=\(category.rawValue) \(elapsedMs)ms"
    }
}

nonisolated struct ProtectedFailure: Equatable, Sendable {
    var code: ProtectedFailureCode
    var stage: String
    var attempt: Int
    var generation: UInt64
    var userMessage: String
    var detail: String
    var probeResults: [ProbeOriginResult]

    var copyableDetail: String {
        let probes = probeResults.map(\.redactedDetail).joined(separator: "; ")
        return [
            "code=\(code.rawValue)",
            "stage=\(stage)",
            "attempt=\(attempt)",
            "generation=\(generation)",
            probes.isEmpty ? nil : "probes=\(probes)",
            detail,
        ].compactMap { $0 }.joined(separator: " | ")
    }
}

nonisolated enum PostLockDecision: Equatable, Sendable {
    case connected(controllerAdvisory: String?)
    case retry(ProtectedFailure)
}

nonisolated enum ConnectivityVerdict: Equatable, Sendable {
    case connected(controllerAdvisory: String?)
    case failed(ProtectedFailure)
}

nonisolated enum ProbeCheck: Equatable, Sendable {
    case ok
    case failed(String)
}

nonisolated enum TUNCheck: Equatable, Sendable {
    case ok
    case failed([ProbeOriginResult])
}

nonisolated enum OriginRace: Equatable, Sendable {
    case won(String)
    case lost([ProbeOriginResult])

    var tunCheck: TUNCheck {
        switch self {
        case .won:
            .ok
        case .lost(let results):
            .failed(results)
        }
    }
}

nonisolated enum ProtectedConnectivity {
    static let postLockVerifyRounds = 2
    static let postLockRoundDelayMsRange = 500...1_000
    /// Happy-eyeballs spacing between the three TLS origins. Bursting them
    /// through a cold Reality/gVisor path made the first round lose to
    /// self-congestion even when the node was fine.
    static let probeStaggerMs = 100

    /// `networkOffline` has to come from a real physical-link observation —
    /// `PhysicalNetworkReachability` on macOS. The primary-network-service
    /// lookup cannot answer it, because it stays non-nil for a configured but
    /// disconnected service, and the physical TCP and bypass probes must not:
    /// those are leak detectors that a correctly armed session is supposed to
    /// fail. Without a real signal an offline Mac lands on the failed/failed
    /// pair below and is diagnosed as an unreachable exit.
    static func classifyPostLock(
        controller: ProbeCheck,
        tun: TUNCheck,
        mixed: ProbeCheck? = nil,
        networkOffline: Bool = false,
        stage: String = "verifyingTraffic",
        attempt: Int = 1,
        generation: UInt64 = 0
    ) -> PostLockDecision {
        if case .ok = tun {
            let advisory: String?
            if case .failed(let error) = controller {
                advisory = error
            } else {
                advisory = nil
            }
            return .connected(controllerAdvisory: advisory)
        }

        let probes: [ProbeOriginResult]
        let tunDetail: String
        if case .failed(let results) = tun {
            probes = results
            tunDetail = results.map(\.redactedDetail).joined(separator: "; ")
        } else {
            probes = []
            tunDetail = "TUN probe failed"
        }

        if networkOffline {
            return .retry(failure(
                .networkEnvironmentOffline,
                stage: stage,
                attempt: attempt,
                generation: generation,
                detail: "physical network unavailable; \(tunDetail)",
                probes: probes
            ))
        }

        let code: ProtectedFailureCode
        let detail: String
        switch (controller, mixed) {
        case (.ok, .some(.ok)):
            code = .tunRouteUnavailable
            detail = "controller and mixed proxy succeeded; real TUN failed: \(tunDetail)"
        case (.failed(let controllerError), .some(.ok)):
            code = .tunRouteUnavailable
            detail = "mixed proxy succeeded; controller=\(controllerError); TUN=\(tunDetail)"
        case (.ok, .some(.failed(let proxyError))):
            code = .tunRouteUnavailable
            detail = "controller succeeded; TUN=\(tunDetail); mixed=\(proxyError)"
        case (.failed(let controllerError), .some(.failed(let proxyError))):
            code = .coreExitUnreachable
            detail = "controller=\(controllerError); TUN=\(tunDetail); mixed=\(proxyError)"
        case (.ok, nil):
            code = .tunRouteUnavailable
            detail = "controller succeeded; real TUN failed: \(tunDetail)"
        case (.failed(let controllerError), nil):
            code = .coreExitUnreachable
            detail = "controller=\(controllerError); TUN=\(tunDetail)"
        }

        return .retry(failure(
            code,
            stage: stage,
            attempt: attempt,
            generation: generation,
            detail: detail,
            probes: probes
        ))
    }

    static func failure(
        _ code: ProtectedFailureCode,
        stage: String,
        attempt: Int,
        generation: UInt64,
        detail: String,
        probes: [ProbeOriginResult] = []
    ) -> ProtectedFailure {
        ProtectedFailure(
            code: code,
            stage: stage,
            attempt: attempt,
            generation: generation,
            userMessage: code.userMessage,
            detail: detail,
            probeResults: probes
        )
    }
}

nonisolated struct ProtectedHealthCounters: Equatable, Sendable {
    var controllerFailures = 0
    var dnsFailures = 0
    var tunFailures = 0
    var coreFailures = 0

    mutating func recordSuccess(controller: Bool, dns: Bool, tun: Bool, core: Bool) {
        if controller { controllerFailures = 0 }
        if dns { dnsFailures = 0 }
        if tun { tunFailures = 0 }
        if core { coreFailures = 0 }
    }

    mutating func recordFailure(controller: Bool, dns: Bool, tun: Bool, core: Bool) {
        if controller { controllerFailures += 1 }
        if dns { dnsFailures += 1 }
        if tun { tunFailures += 1 }
        if core { coreFailures += 1 }
    }

    var shouldEnterRecovering: Bool {
        tunFailures >= 2 || dnsFailures >= 2 || coreFailures >= 2
    }
}

enum SessionRuntimePorts {
    static func allocatePair() -> (mixed: Int, controller: Int) {
        let first = bindEphemeralPort()
        var second = bindEphemeralPort()
        if second == first {
            second = bindEphemeralPort()
        }
        return (first ?? 28_790, second ?? 29_090)
    }

    private static func bindEphemeralPort() -> Int? {
        let fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP)
        guard fd >= 0 else { return nil }
        defer { close(fd) }
        var reuse: Int32 = 1
        _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        address.sin_port = 0
        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else { return nil }
        var bound = sockaddr_in()
        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &bound) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(fd, $0, &length)
            }
        }
        guard nameResult == 0 else { return nil }
        let port = Int(UInt16(bigEndian: bound.sin_port))
        return (1024...65_535).contains(port) ? port : nil
    }
}
