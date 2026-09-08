import Foundation
import Darwin

extension LocalTrafficAudit {
    func recordResearchProtection(
        _ protection: TrafficAuditProtectionSnapshot
    ) {
        researchProtection = protection
        if protection.connected
            && (!protection.killSwitchArmed
                || !protection.tunPresent
                || !protection.protectedDNSConfigured) {
            researchUnsafeProtectionObservationCount = min(
                researchUnsafeProtectionObservationCount + 1,
                Self.maximumResearchCount
            )
        }
    }

    func recordResearchConnectionObservation(
        _ connection: APIConnection,
        residentialContext: ResidentialRouteAuditContext?
    ) {
        guard !researchSeenConnectionIDs.contains(connection.id) else { return }
        researchSeenConnectionIDs.insert(connection.id)
        researchSeenConnectionOrder.append(connection.id)
        // Prune dedup memory instead of freezing every counter forever once
        // 20k unique connections have been seen. Dropping the oldest IDs can
        // at worst double-count a connection that outlives 18k successors,
        // which is far better than a silently dead metric.
        if researchSeenConnectionOrder.count > Self.maximumResearchConnections {
            researchConnectionLimitReached = true
            let expired = researchSeenConnectionOrder.prefix(2_000)
            researchSeenConnectionIDs.subtract(expired)
            researchSeenConnectionOrder.removeFirst(expired.count)
        }
        researchObservedConnectionCount = min(
            researchObservedConnectionCount + 1,
            Self.maximumResearchCount
        )
        let process = (connection.metadata.process ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let processPath = (connection.metadata.processPath ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let processIdentified = Self.processIsIdentified(
            process: process,
            processPath: processPath
        )
        if processIdentified {
            researchIdentifiedProcessConnectionCount = min(
                researchIdentifiedProcessConnectionCount + 1,
                Self.maximumResearchCount
            )
        }
        let route = Self.routeClassification(
            connection,
            residentialContext: residentialContext
        )
        let isWeChat = Self.isNativeWeChatProcess(processPath)
        let isManagedDirect = Self.isManagedDirectConnection(connection)
        let isWebManagedDirect = Self.isWebManagedDirectConnection(connection)
        if isWebManagedDirect {
            researchWebManagedDirectConnectionCount = min(
                researchWebManagedDirectConnectionCount + 1,
                Self.maximumResearchCount
            )
        }
        if isWeChat {
            researchWeChatConnectionCount = min(
                researchWeChatConnectionCount + 1,
                Self.maximumResearchCount
            )
            switch route {
            case "DIRECT" where isManagedDirect || isWebManagedDirect:
                researchWeChatManagedDirectConnectionCount = min(
                    researchWeChatManagedDirectConnectionCount + 1,
                    Self.maximumResearchCount
                )
            case "DIRECT":
                // Unmanaged direct is neither a managed-direct success nor a
                // proxy verdict. It stays visible through the global direct
                // counter instead of skewing the WeChat proxied count.
                break
            case "BLOCKED":
                researchWeChatBlockedConnectionCount = min(
                    researchWeChatBlockedConnectionCount + 1,
                    Self.maximumResearchCount
                )
            default:
                researchWeChatProxiedConnectionCount = min(
                    researchWeChatProxiedConnectionCount + 1,
                    Self.maximumResearchCount
                )
            }
        } else if isManagedDirect {
            if processIdentified {
                researchOtherManagedDirectConnectionCount = min(
                    researchOtherManagedDirectConnectionCount + 1,
                    Self.maximumResearchCount
                )
            } else {
                researchUnknownManagedDirectConnectionCount = min(
                    researchUnknownManagedDirectConnectionCount + 1,
                    Self.maximumResearchCount
                )
            }
        }
        // Endpoint-based safety net for WeChat attribution gaps: count every
        // WeChat-destined flow that the bundle-path predicate above did NOT
        // claim, whether the process was identified (a helper outside the
        // reviewed bundle, a relocated install) or unknown. Gating this on
        // unidentified processes hid exactly the dominant gap.
        if !isWeChat,
           Self.isWeChatEndpoint(connection.metadata.host) {
            researchWeChatEndpointUnknownProcessConnectionCount = min(
                researchWeChatEndpointUnknownProcessConnectionCount + 1,
                Self.maximumResearchCount
            )
        }
        if route == "DIRECT", Self.isProtectedClaudeConnection(connection) {
            researchProtectedDirectConnectionCount = min(
                researchProtectedDirectConnectionCount + 1,
                Self.maximumResearchCount
            )
        }
        if route == "PROXIED",
           residentialContext?.contractRequired == true,
           Self.isProtectedClaudeConnection(connection) {
            // A generic proxy protects privacy but violates the stronger
            // residential-only Claude contract just as surely as DIRECT.
            researchUnsafeProtectionObservationCount = min(
                researchUnsafeProtectionObservationCount + 1,
                Self.maximumResearchCount
            )
        }
        switch route {
        case "RESIDENTIAL":
            researchResidentialConnectionCount = min(
                researchResidentialConnectionCount + 1,
                Self.maximumResearchCount
            )
        case "DIRECT":
            researchDirectConnectionCount = min(
                researchDirectConnectionCount + 1,
                Self.maximumResearchCount
            )
        case "BLOCKED":
            researchBlockedConnectionCount = min(
                researchBlockedConnectionCount + 1,
                Self.maximumResearchCount
            )
        default:
            researchProxiedConnectionCount = min(
                researchProxiedConnectionCount + 1,
                Self.maximumResearchCount
            )
        }
    }

    static func processIsIdentified(
        process: String,
        processPath: String
    ) -> Bool {
        (!process.isEmpty && process.lowercased() != "unknown")
            || (!processPath.isEmpty && processPath.lowercased() != "unknown")
    }

    static func isNativeWeChatProcess(_ processPath: String) -> Bool {
        // Match the whole reviewed bundle, mirroring the routing rules: image
        // and media traffic comes from helper executables inside the bundle,
        // not the main binary.
        let path = processPath.lowercased()
        return ConfigPipeline.wechatProcessBundlePaths.contains {
            path.hasPrefix($0.lowercased())
        }
    }

    static func isManagedDirectConnection(_ connection: APIConnection) -> Bool {
        connection.chains.contains {
            $0.caseInsensitiveCompare(ConfigPipeline.directProxyName) == .orderedSame
        }
    }

    static func isWebManagedDirectConnection(
        _ connection: APIConnection
    ) -> Bool {
        connection.chains.contains {
            $0.caseInsensitiveCompare(
                ConfigPipeline.webDirectProxyName
            ) == .orderedSame
        }
    }

    static func isWeChatEndpoint(_ rawHost: String) -> Bool {
        let host = rawHost.lowercased().trimmingCharacters(
            in: CharacterSet(charactersIn: ".")
        )
        // WeChat-specific subtrees only. Bare "qq.com" matched every Tencent
        // property (QQ Music, mail, game CDNs) and drowned the counter this
        // suffix list feeds in non-WeChat traffic.
        let suffixes = [
            "weixin.qq.com", "wx.qq.com", "wxs.qq.com", "tc.qq.com",
            "qpic.cn", "qlogo.cn", "gtimg.cn",
            "gtimg.com", "wechat.com", "weixin.com", "weixinbridge.com",
            "wechatos.net",
        ]
        return suffixes.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    static func isClaudeResidentialHost(_ host: String) -> Bool {
        let suffixes = [
            "claude.ai", "claude.com", "anthropic.com",
            "anthropic.ai",
            "claudeusercontent.com", "clau.de", "claude.app",
            "claude.site", "claudestudio.com",
            "claudemcpclient.com", "claudemcpcontent.com",
            "servd-anthropic-website.b-cdn.net",
            "challenges.cloudflare.com", "cf-assets.www.cloudflare.com",
            "cloudflareinsights.com",
            "browser-intake-datadoghq.com",
            "browser-intake-us5-datadoghq.com",
            "browser-intake-us3-datadoghq.com",
            "browser-intake-ap1-datadoghq.com",
            "browser-intake-ap2-datadoghq.com",
            "browser-intake-datadoghq.eu",
            "browser-intake-ddog-gov.com", "datadoghq.com",
            "statsigapi.net", "featuregates.org", "growthbook.io",
            "stripe.network", "storage.googleapis.com",
            "registry.npmjs.org", "raw.githubusercontent.com",
            "formulae.brew.sh", "sentry.io",
        ]
        return suffixes.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    static func isProtectedClaudeConnection(
        _ connection: APIConnection
    ) -> Bool {
        let host = connection.metadata.host.lowercased().trimmingCharacters(
            in: CharacterSet(charactersIn: ".")
        )
        if isClaudeResidentialHost(host) {
            return true
        }
        let process = connection.metadata.process ?? ""
        let processPath = connection.metadata.processPath ?? ""
        return ConfigPipeline.isClaudeCodeIdentity(
            process: process,
            processPath: processPath
        ) || ConfigPipeline.isClaudeAppIdentity(
            process: process,
            processPath: processPath
        )
    }

    func recordClaudeTrafficResearch(
        _ connection: APIConnection,
        residentialContext: ResidentialRouteAuditContext?
    ) {
        guard let key = Self.claudeTrafficResearchKey(
            connection,
            residentialContext: residentialContext
        ) else { return }
        let upBytes = min(
            max(connection.upload, 0),
            Self.maximumResearchBytes
        )
        let downBytes = min(
            max(connection.download, 0),
            Self.maximumResearchBytes
        )

        if var previous = researchConnections[connection.id] {
            guard previous.key == key,
                  var total = researchTotals[key] else { return }
            total.upBytes = min(
                total.upBytes + max(0, upBytes - previous.upBytes),
                Self.maximumResearchBytes
            )
            total.downBytes = min(
                total.downBytes + max(0, downBytes - previous.downBytes),
                Self.maximumResearchBytes
            )
            previous.upBytes = max(previous.upBytes, upBytes)
            previous.downBytes = max(previous.downBytes, downBytes)
            researchConnections[connection.id] = previous
            researchTotals[key] = total
            return
        }

        guard researchTotals[key] != nil
                || researchTotals.count < Self.maximumResearchEndpointKeys else {
            if researchDroppedKeys.count < Self.maximumResearchEndpointKeys {
                researchDroppedKeys.insert(key)
            }
            return
        }
        if researchConnections.count >= Self.maximumResearchConnections {
            // Mirrors the dedup map's pruning rather than returning forever:
            // returning froze `researchTotals` for the rest of the session once
            // 20k connections had been seen, so the metric silently died on any
            // long-lived session. Evicting the oldest byte cursors can at worst
            // double-count a connection that outlives 18k successors, which the
            // sibling map already accepts for the same reason.
            researchConnectionLimitReached = true
            let expired = researchConnectionOrder.prefix(2_000)
            for identifier in expired { researchConnections[identifier] = nil }
            researchConnectionOrder.removeFirst(expired.count)
        }
        researchConnectionOrder.append(connection.id)
        var total = researchTotals[key] ?? ClaudeTrafficResearchTotal(
            connections: 0,
            upBytes: 0,
            downBytes: 0
        )
        total.connections = min(total.connections + 1, 1_000_000)
        total.upBytes = min(
            total.upBytes + upBytes,
            Self.maximumResearchBytes
        )
        total.downBytes = min(
            total.downBytes + downBytes,
            Self.maximumResearchBytes
        )
        researchTotals[key] = total
        researchConnections[connection.id] = ClaudeTrafficResearchConnection(
            key: key,
            upBytes: upBytes,
            downBytes: downBytes
        )
    }

    static func claudeTrafficResearchKey(
        _ connection: APIConnection,
        residentialContext: ResidentialRouteAuditContext?
    ) -> ClaudeTrafficResearchKey? {
        let host = connection.metadata.host.lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard isResearchHostname(host) else { return nil }
        let network = connection.metadata.network.uppercased()
        guard network == "TCP" || network == "UDP",
              let port = Int(connection.metadata.destinationPort ?? ""),
              (1...65_535).contains(port) else { return nil }

        let process = connection.metadata.process ?? ""
        let processPath = connection.metadata.processPath ?? ""
        let client: String
        if ConfigPipeline.isClaudeAppIdentity(
            process: process,
            processPath: processPath
        ) {
            client = "app"
        } else if ConfigPipeline.isClaudeCodeIdentity(
            process: process,
            processPath: processPath
        ) {
            client = "code"
        } else if [
            "safari", "google chrome", "chromium", "arc", "firefox",
            "brave browser", "microsoft edge",
        ].contains(where: {
            process == $0 || processPath.contains("/\($0).app/")
        }) {
            client = "web"
        } else {
            client = "unknown"
        }

        let service: String
        if host == "claude.ai" || host.hasSuffix(".claude.ai")
            || host == "claude.com" || host.hasSuffix(".claude.com")
            || host == "clau.de" || host.hasSuffix(".clau.de")
            || host == "claudeusercontent.com"
            || host.hasSuffix(".claudeusercontent.com") {
            service = "claude"
        } else if host == "anthropic.com"
                    || host.hasSuffix(".anthropic.com") {
            service = "anthropic"
        } else if client == "app" || client == "code" {
            // Only a positively attributed Claude process may contribute a
            // non-official destination. Browser processes are intentionally
            // excluded because Mihomo cannot identify which browser tab made
            // a request, and child tools remain explicitly reported as an
            // attribution-coverage limitation rather than guessed.
            service = "other"
        } else {
            return nil
        }

        // The research consent promises aggregates and verdicts, not browsing
        // destinations. Official Claude/Anthropic hostnames are the research
        // subject and may be transmitted; every other destination is folded
        // into a single "other" bucket so no third-party hostname leaves the
        // device.
        let reportedHost = (service == "claude" || service == "anthropic")
            ? host
            : "other"
        return ClaudeTrafficResearchKey(
            service: service,
            client: client,
            host: reportedHost,
            network: network,
            port: port,
            route: routeClassification(
                connection,
                residentialContext: residentialContext
            )
        )
    }

    static func isResearchHostname(_ host: String) -> Bool {
        guard !host.isEmpty, host.utf8.count <= 100,
              host.unicodeScalars.allSatisfy({ $0.isASCII }),
              !host.contains("..") else { return false }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2,
              labels.allSatisfy({ label in
                  guard !label.isEmpty, label.utf8.count <= 63,
                        label.first != "-", label.last != "-" else {
                      return false
                  }
                  return label.allSatisfy {
                      $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-")
                  }
              }),
              let topLevel = labels.last,
              topLevel.count >= 2,
              topLevel.allSatisfy({ $0.isASCII && $0.isLetter }) else {
            return false
        }
        return !["local", "internal", "localhost", "home", "lan"].contains(
            String(topLevel)
        )
    }

    static func displayProcessField(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "unknown" }
        return value
    }

    static let redactedHomePrefix = "/Users/<redacted>"

    /// A process path under a home directory carries the account's short name
    /// in `/Users/<name>/`, and this file is drained by the log upload. Replace
    /// that one component where the path enters a record and keep the rest: the
    /// bundle and the executable are what a `process_path` is read for. Paths
    /// with no such component, `/Users/Shared` among them, are a location
    /// rather than an account and stay as they are.
    static func displayProcessPath(_ value: String?) -> String {
        let path = displayProcessField(value)
        let prefix = "/Users/"
        guard path.hasPrefix(prefix) else { return path }
        let remainder = path.dropFirst(prefix.count)
        let owner = remainder.prefix(while: { $0 != "/" })
        guard owner != "Shared" else { return path }
        return redactedHomePrefix + String(remainder.dropFirst(owner.count))
    }

    static func routeClassification(
        _ connection: APIConnection,
        residentialContext: ResidentialRouteAuditContext?
    ) -> String {
        let upperRouteValues = connection.chains.map { $0.uppercased() }
        let upperRule = connection.rule.uppercased()
        if upperRule.hasPrefix("REJECT")
            || upperRouteValues.contains(where: { $0.hasPrefix("REJECT") }) {
            return "BLOCKED"
        }
        // Mihomo's connections API orders chains terminal-first (matching the
        // native Windows consumer and retained API fixtures). A selector with
        // the same name later in the chain is not proof of the actual egress.
        if let terminal = residentialContext?.admittedTerminal?.uppercased(),
           upperRouteValues.first == terminal {
            return "RESIDENTIAL"
        }
        if upperRouteValues.contains("DIRECT")
            || upperRouteValues.contains(ConfigPipeline.directProxyName.uppercased())
            || upperRouteValues.contains(
                ConfigPipeline.webDirectProxyName.uppercased()
            )
            || upperRule == "DIRECT" {
            return "DIRECT"
        }
        return "PROXIED"
    }
}
