import Foundation
import CryptoKit
import Darwin
import AppKit
import Security

/// Produces runtime.yaml from subscription YAML + minimal overlay.
/// Follows Verge's principle: subscription config is immutable, overlay only control fields.
extension ConfigPipeline {
    static let managedDirectProtectedSuffixes = [
        "anthropic.com", "claude.ai", "claude.com", "claude.app",
        "claude.site", "clau.de", "anthropic.ai", "claudestudio.com",
        "claudemcpclient.com", "claudemcpcontent.com", "claudeusercontent.com",
        "servd-anthropic-website.b-cdn.net", "challenges.cloudflare.com",
        "cf-assets.www.cloudflare.com", "cloudflareinsights.com",
        "browser-intake-datadoghq.com", "browser-intake-us5-datadoghq.com",
        "browser-intake-us3-datadoghq.com",
        "browser-intake-ap1-datadoghq.com",
        "browser-intake-ap2-datadoghq.com",
        "browser-intake-datadoghq.eu", "browser-intake-ddog-gov.com",
        "datadoghq.com", "statsig.com", "statsigapi.net", "featuregates.org",
        "growthbook.io", "stripe.com", "stripecdn.com", "link.com", "hcaptcha.com", "stripe.network", "storage.googleapis.com",
        "registry.npmjs.org", "raw.githubusercontent.com", "formulae.brew.sh",
        "sentry.io",
        "tono.app", "tono.com",
    ]

    static func isProtectedFromDirect(_ host: String) -> Bool {
        managedDirectProtectedSuffixes.contains {
            host == $0 || host.hasSuffix(".\($0)")
        }
    }

    static func directSuffixOverlapsProtected(_ host: String) -> Bool {
        isProtectedFromDirect(host) || managedDirectProtectedSuffixes.contains {
            $0.hasSuffix(".\(host)")
        }
    }

    /// `trusted` is set only after an Ed25519 signature over the policy document
    /// has verified against the compiled-in public key. It skips the allowlist
    /// and nothing else: hostname syntax and the protected suffixes above are
    /// still enforced, because a signature attests to authorship, not to the
    /// document being well formed or safe.
    static func validatedManagedDirectDomain(
        _ raw: String,
        trusted: Bool = false
    ) throws -> String {
        let host = try normalizedHost(raw, field: "managed direct domain")
        guard !isProtectedFromDirect(host) else {
            throw TonoInjectionError.unsafeNode("managed direct domain")
        }
        if trusted { return host }
        guard managedNativeDirectSuffixAllowlist.contains(where: {
            host == $0 || host.hasSuffix(".\($0)")
        }) else {
            throw TonoInjectionError.unsafeNode("managed direct domain")
        }
        return host
    }

    static func validatedWebDirectDomain(
        _ raw: String,
        trusted: Bool = false
    ) throws -> String {
        let host = try normalizedHost(raw, field: "managed web direct domain")
        guard !isProtectedFromDirect(host) else {
            throw TonoInjectionError.unsafeNode("managed web direct domain")
        }
        if trusted { return host }
        let allowedSuffixes = managedWebDirectSuffixAllowlist
        let allowedExactHosts = ["ykimg.alicdn.com"]
        guard allowedExactHosts.contains(host) || allowedSuffixes.contains(where: {
            host == $0 || host.hasSuffix(".\($0)")
        }) else {
            throw TonoInjectionError.unsafeNode("managed web direct domain")
        }
        return host
    }

    /// Validate the exact suffix value used by traffic-policy v3. A host such
    /// as `www.edu.cn` is valid for an exact web pin, but it is not itself an
    /// admitted suffix rule; only `edu.cn` may be emitted here.
    static func validatedManagedDirectSuffix(
        _ raw: String,
        trusted: Bool = false
    ) throws -> String {
        let host = try normalizedHost(raw, field: "managed direct suffix")
        guard !directSuffixOverlapsProtected(host) else {
            throw TonoInjectionError.unsafeNode("managed direct suffix")
        }
        if trusted { return host }
        guard managedWebDirectSuffixAllowlist.contains(host) else {
            throw TonoInjectionError.unsafeNode("managed direct suffix")
        }
        return host
    }

    /// The address endpoints — UDP media and reviewed TCP — carry the same
    /// trust gate as the domain routes above, and for the same reason: an
    /// endpoint is a destination leaving the tunnel over the user's own path,
    /// and whether it is written as a name or as an address changes nothing
    /// about that. `trusted` skips the allowlist and nothing else; the value
    /// must still be a public IPv4 literal, and the caller's protected
    /// addresses are excluded separately.
    ///
    /// `allowlist` is a parameter with the compiled-in list as its default so
    /// prefix matching can be exercised while the shipped list is empty. Every
    /// caller in the app uses the default; passing another list weakens nothing,
    /// because a caller that could choose the list could equally pass `trusted`.
    static func validatedManagedDirectAddress(
        _ raw: String,
        field: String,
        trusted: Bool = false,
        allowlist: [String] = Self.managedDirectIPv4Allowlist
    ) throws -> String {
        let address = try validatedPublicIPv4(raw, field: field)
        if trusted { return address }
        guard isManagedDirectAllowlistedIPv4(address, allowlist: allowlist) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        return address
    }

    /// Membership in `managedDirectIPv4Allowlist`. An entry that does not parse
    /// as a prefix matches nothing rather than everything, so empty components
    /// are kept: a leading, doubled or trailing slash is a typo in a list that
    /// carves traffic out of the tunnel, and it is refused rather than read
    /// through.
    static func isManagedDirectAllowlistedIPv4(
        _ address: String,
        allowlist: [String] = Self.managedDirectIPv4Allowlist
    ) -> Bool {
        guard let candidate = ipv4Value(address) else { return false }
        return allowlist.contains { entry in
            let parts = entry.split(separator: "/", omittingEmptySubsequences: false)
            guard parts.count == 2,
                  let bits = Int(parts[1]), bits >= 1, bits <= 32,
                  let network = ipv4Value(String(parts[0])) else {
                return false
            }
            let mask: UInt32 = UInt32.max << (32 - bits)
            return candidate & mask == network & mask
        }
    }

    static func ipv4Value(_ raw: String) -> UInt32? {
        var address = in_addr()
        guard inet_pton(AF_INET, raw, &address) == 1 else { return nil }
        let bytes = withUnsafeBytes(of: address) { Array($0) }
        guard bytes.count == 4 else { return nil }
        return (UInt32(bytes[0]) << 24) | (UInt32(bytes[1]) << 16)
            | (UInt32(bytes[2]) << 8) | UInt32(bytes[3])
    }

    static func validatedManagedDirectPolicy(
        _ policy: ManagedDirectRuntimePolicy?,
        excluding protectedAddresses: Set<String> = []
    ) throws -> ManagedDirectRuntimePolicy? {
        guard let policy else { return nil }
        let interface = policy.physicalInterface
        guard interface.range(
            of: #"^[a-z][a-z0-9_]{0,14}$"#,
            options: .regularExpression
        ) == interface.startIndex..<interface.endIndex,
              interface != "lo0", !interface.hasPrefix("utun") else {
            throw TonoInjectionError.unsafeOverlay
        }
        if policy.isEmpty { return policy }
        let permanentlyProtected = protectedAddresses.union(["1.1.1.1", "8.8.8.8"])
        guard policy.domainPins.count <= 32,
              policy.webDomainPins.count <= 32,
              policy.webDomainSuffixes.count <= 64,
              policy.mediaEndpoints.count <= 128,
              policy.tcpEndpoints.count <= 128,
              policy.sessionEndpoints.count <= maximumSessionDirectEndpoints,
              // Resolver hosts are one entry per managed or web direct policy
              // hostname, so this must admit the control plane's own maxima
              // (32 `domains` + 32 `webDomains`). A lower ceiling silently
              // discarded the entire managed-direct policy — every WeChat and
              // web direct route with it — as soon as the published policy grew
              // past it, leaving only a local audit event behind.
              policy.directResolverHosts.count <= 64 else {
            throw TonoInjectionError.unsafeOverlay
        }
        // Resolver hosts feed nameserver-policy emission; each must be a
        // cloud-reviewed managed or web direct hostname, unique after
        // normalization.
        let resolverHosts = try policy.directResolverHosts.map { raw -> String in
            if let host = try? validatedManagedDirectDomain(
                raw,
                trusted: policy.trusted
            ) { return host }
            return try validatedWebDirectDomain(raw, trusted: policy.trusted)
        }
        guard Set(resolverHosts).count == resolverHosts.count else {
            throw TonoInjectionError.unsafeOverlay
        }

        var seenHosts = Set<String>()
        let pins = try policy.domainPins.map { pin in
            let host = try validatedManagedDirectDomain(
                pin.host,
                trusted: policy.trusted
            )
            guard seenHosts.insert(host).inserted,
                  !pin.addresses.isEmpty, pin.addresses.count <= 8,
                  !pin.ports.isEmpty,
                  Set(pin.ports).count == pin.ports.count,
                  pin.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                throw TonoInjectionError.unsafeNode("managed direct domain")
            }
            let addresses = try pin.addresses.map {
                try validatedPublicIPv4($0, field: "managed direct address")
            }
            guard Set(addresses).count == addresses.count,
                  addresses.allSatisfy({ !permanentlyProtected.contains($0) }) else {
                throw TonoInjectionError.unsafeNode("managed direct address")
            }
            return DirectDomainPin(
                host: host,
                addresses: addresses.sorted(),
                ports: pin.ports.sorted()
            )
        }.sorted { $0.host < $1.host }

        let webPins = try policy.webDomainPins.map { pin in
            let host = try validatedWebDirectDomain(
                pin.host,
                trusted: policy.trusted
            )
            guard seenHosts.insert(host).inserted,
                  !pin.addresses.isEmpty, pin.addresses.count <= 8,
                  pin.ports == [443] else {
                throw TonoInjectionError.unsafeNode("managed web direct domain")
            }
            let addresses = try pin.addresses.map {
                try validatedPublicIPv4($0, field: "managed web direct address")
            }
            guard Set(addresses).count == addresses.count,
                  addresses.allSatisfy({ !permanentlyProtected.contains($0) }) else {
                throw TonoInjectionError.unsafeNode("managed web direct address")
            }
            return DirectDomainPin(
                host: host,
                addresses: addresses.sorted(),
                ports: [443]
            )
        }.sorted { $0.host < $1.host }

        var seenSuffixes = Set<String>()
        let webDomainSuffixes = try policy.webDomainSuffixes.map { suffix in
            let host = try validatedManagedDirectSuffix(
                suffix.host,
                trusted: policy.trusted
            )
            guard host == suffix.host,
                  seenSuffixes.insert(host).inserted,
                  !suffix.ports.isEmpty,
                  Set(suffix.ports).count == suffix.ports.count,
                  suffix.ports.allSatisfy({ $0 == 80 || $0 == 443 }) else {
                throw TonoInjectionError.unsafeNode("managed direct suffix")
            }
            let ports = suffix.ports.sorted()
            return DirectDomainSuffix(host: host, ports: ports)
        }.sorted { $0.host < $1.host }

        let media = try policy.mediaEndpoints.map { endpoint in
            let address = try validatedManagedDirectAddress(
                endpoint.address,
                field: "managed media address",
                trusted: policy.trusted
            )
            guard !permanentlyProtected.contains(address),
                  endpoint.transport == "udp",
                  endpoint.port == 443 || endpoint.port == 8000 else {
                throw TonoInjectionError.unsafeNode("managed media endpoint")
            }
            return DirectEndpoint(
                address: address,
                port: endpoint.port,
                transport: "udp"
            )
        }
        let uniqueMedia = Array(Set(media)).sorted {
            ($0.port, $0.address) < ($1.port, $1.address)
        }
        let tcp = try policy.tcpEndpoints.map { endpoint in
            let address = try validatedManagedDirectAddress(
                endpoint.address,
                field: "managed TCP address",
                trusted: policy.trusted
            )
            guard !permanentlyProtected.contains(address),
                  endpoint.transport == "tcp",
                  endpoint.port == 80 || endpoint.port == 443 else {
                throw TonoInjectionError.unsafeNode("managed TCP endpoint")
            }
            return DirectEndpoint(
                address: address,
                port: endpoint.port,
                transport: "tcp"
            )
        }
        let uniqueTCP = Array(Set(tcp)).sorted {
            ($0.port, $0.address) < ($1.port, $1.address)
        }
        return ManagedDirectRuntimePolicy(
            physicalInterface: interface,
            domainPins: pins,
            webDomainPins: webPins,
            webDomainSuffixes: webDomainSuffixes,
            mediaEndpoints: uniqueMedia,
            tcpEndpoints: uniqueTCP,
            directResolverHosts: resolverHosts.sorted(),
            trusted: policy.trusted,
            nativeAppDirect: policy.nativeAppDirect
        )
    }

    /// True when an already-normalized host is either a DNS name or a public
    /// IPv4 literal. A normalized host that parses as an address but is not
    /// public is rejected; hostnames are resolved later through the protected
    /// resolver and are screened again there.
    static func isPublicHostCandidate(_ host: String) -> Bool {
        var ipv4 = in_addr()
        if inet_pton(AF_INET, host, &ipv4) == 1 { return isPublicIPv4(ipv4) }
        var ipv6 = in6_addr()
        if inet_pton(AF_INET6, host, &ipv6) == 1 { return false }
        return true
    }

    static func isPublicIPv4(_ address: in_addr) -> Bool {
        let bytes = withUnsafeBytes(of: address) { Array($0) }
        guard bytes.count == 4 else { return false }
        return bytes[0] != 0 &&
            bytes[0] != 10 &&
            bytes[0] != 127 &&
            !(bytes[0] == 100 && (64...127).contains(bytes[1])) &&
            !(bytes[0] == 169 && bytes[1] == 254) &&
            !(bytes[0] == 172 && (16...31).contains(bytes[1])) &&
            !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 0) &&
            !(bytes[0] == 192 && bytes[1] == 0 && bytes[2] == 2) &&
            !(bytes[0] == 192 && bytes[1] == 168) &&
            // 6to4 relay anycast. The control plane rejects it too; without
            // this the two sides disagreed about what "public" means.
            !(bytes[0] == 192 && bytes[1] == 88 && bytes[2] == 99) &&
            !(bytes[0] == 198 && (18...19).contains(bytes[1])) &&
            !(bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100) &&
            !(bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113) &&
            bytes[0] < 224
    }

    static func normalizedHost(_ raw: String, field: String) throws -> String {
        let host = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !host.isEmpty, host.utf8.count <= 253, !host.contains("%"),
              host.unicodeScalars.allSatisfy({ $0.isASCII && $0.value > 0x20 && $0.value < 0x7F }) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        var ipv4 = in_addr()
        var ipv6 = in6_addr()
        if inet_pton(AF_INET, host, &ipv4) == 1 || inet_pton(AF_INET6, host, &ipv6) == 1 {
            return host
        }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ label in
            guard !label.isEmpty, label.utf8.count <= 63,
                  label.first != "-", label.last != "-" else { return false }
            return label.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-") }
        }) else {
            throw TonoInjectionError.unsafeNode(field)
        }
        return host
    }

    /// Extract the `proxies:` sequence body only (list items under proxies).
}
