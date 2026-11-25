import XCTest
@testable import Tono

/// A media or TCP endpoint is a destination carved out of the tunnel and dialed
/// over the user's own ISP path — the same thing a domain route is, and the same
/// thing a compromised control plane would ask for. Domain routes are honoured
/// on a verified signature or a compiled-in allowlist; these assert the address
/// routes are honoured on nothing weaker, since "is it a public IPv4" admits
/// every address on the internet.
final class ManagedDirectAddressTrustTests: XCTestCase {
    /// Public, distinct, and not on any allowlist this build ships. The
    /// 203.0.113.0/24 documentation range would have been rejected as
    /// non-public before the trust gate ever ran.
    private let mediaEndpoint = ConfigPipeline.DirectEndpoint(
        address: "51.1.2.3",
        port: 443,
        transport: "udp"
    )
    private let tcpEndpoint = ConfigPipeline.DirectEndpoint(
        address: "51.4.5.6",
        port: 443,
        transport: "tcp"
    )

    private func policy(
        media: [ConfigPipeline.DirectEndpoint] = [],
        tcp: [ConfigPipeline.DirectEndpoint] = [],
        tcpDirectAddresses: [String] = [],
        trusted: Bool
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy {
        ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            webDomainPins: [],
            webDomainSuffixes: [],
            mediaEndpoints: media,
            tcpEndpoints: tcp,
            tcpDirectAddresses: tcpDirectAddresses,
            directResolverHosts: [],
            trusted: trusted
        )
    }

    func testUnsignedPolicyMayNotCarveOutAnUnlistedAddress() {
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
            policy(media: [mediaEndpoint], trusted: false)
        ))
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
            policy(tcp: [tcpEndpoint], trusted: false)
        ))
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectAddress(
            mediaEndpoint.address,
            field: "managed media address"
        ))
    }

    func testSignedPolicyKeepsItsAddressesUnchanged() throws {
        let validated = try ConfigPipeline.validatedManagedDirectPolicy(
            policy(media: [mediaEndpoint], tcp: [tcpEndpoint], trusted: true)
        )
        XCTAssertEqual(validated?.mediaEndpoints, [mediaEndpoint])
        XCTAssertEqual(validated?.tcpEndpoints, [tcpEndpoint])
        XCTAssertEqual(
            try ConfigPipeline.validatedManagedDirectAddress(
                mediaEndpoint.address,
                field: "managed media address",
                trusted: true
            ),
            mediaEndpoint.address
        )
    }

    /// The shipped list is empty, so the honoured case is exercised against a
    /// supplied one. A prefix admits its own range and nothing either side of
    /// it: a list that matched more than it says would be the same defect as
    /// having no list.
    func testAnAllowlistedPrefixIsHonouredWithoutASignature() throws {
        let allowlist = ["51.1.0.0/16", "51.4.5.6/32"]
        XCTAssertEqual(
            try ConfigPipeline.validatedManagedDirectAddress(
                mediaEndpoint.address,
                field: "managed media address",
                allowlist: allowlist
            ),
            mediaEndpoint.address
        )
        XCTAssertTrue(ConfigPipeline.isManagedDirectAllowlistedIPv4(
            "51.1.255.255",
            allowlist: allowlist
        ))
        XCTAssertFalse(ConfigPipeline.isManagedDirectAllowlistedIPv4(
            "51.2.0.0",
            allowlist: allowlist
        ))
        XCTAssertFalse(ConfigPipeline.isManagedDirectAllowlistedIPv4(
            "51.0.255.255",
            allowlist: allowlist
        ))
        XCTAssertTrue(ConfigPipeline.isManagedDirectAllowlistedIPv4(
            "51.4.5.6",
            allowlist: allowlist
        ))
        XCTAssertFalse(ConfigPipeline.isManagedDirectAllowlistedIPv4(
            "51.4.5.7",
            allowlist: allowlist
        ))
    }

    /// An entry that does not parse is not a wildcard, and neither is an empty
    /// list. Both are the state this build ships in.
    func testAMalformedOrAbsentEntryAdmitsNothing() {
        XCTAssertFalse(ConfigPipeline.isManagedDirectAllowlistedIPv4(
            mediaEndpoint.address,
            allowlist: []
        ))
        let malformed = [
            "51.1.0.0", "51.1.0.0/", "51.1.0.0/33", "51.1.0.0/0", "/16",
            // A stray slash is how a live prefix gets typed by accident, and
            // each of these would otherwise read through as `51.1.0.0/16`.
            "/51.1.0.0/16", "51.1.0.0//16", "51.1.0.0/16/",
        ]
        for entry in malformed {
            XCTAssertFalse(
                ConfigPipeline.isManagedDirectAllowlistedIPv4(
                    mediaEndpoint.address,
                    allowlist: [entry]
                ),
                entry
            )
        }
    }

    /// A signature relaxes which destinations may leave the tunnel, never which
    /// may not. The protected addresses are checked after the trust gate, so a
    /// trusted policy naming one is still refused.
    func testSignatureDoesNotRelaxTheProtectedAddresses() {
        let resolver = ConfigPipeline.DirectEndpoint(
            address: "8.8.8.8",
            port: 443,
            transport: "udp"
        )
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
            policy(media: [resolver], trusted: true)
        ))
    }

    func testSignedPolicyAcceptsCustomTCPPortsAndDirectTCPAddresses() throws {
        let customTCP = ConfigPipeline.DirectEndpoint(
            address: "51.4.5.6",
            port: 55300,
            transport: "tcp"
        )
        let validated = try ConfigPipeline.validatedManagedDirectPolicy(
            policy(
                tcp: [customTCP],
                tcpDirectAddresses: ["103.253.207.41", "81.69.152.51"],
                trusted: true
            )
        )
        XCTAssertEqual(validated?.tcpEndpoints, [customTCP])
        XCTAssertEqual(validated?.tcpDirectAddresses, ["103.253.207.41", "81.69.152.51"])
        XCTAssertTrue(validated?.sessionEndpoints.contains(customTCP) == true)

        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
            policy(tcp: [customTCP], trusted: false)
        ))
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
            policy(tcpDirectAddresses: ["81.69.152.51"], trusted: false)
        ))
    }

    func testProtectedIPsDNSPortsAndOverlapsAreRejectedEvenWhenSigned() {
        for blockedPort: UInt16 in [0, 53, 853] {
            let dnsPort = ConfigPipeline.DirectEndpoint(
                address: "51.4.5.6",
                port: blockedPort,
                transport: "tcp"
            )
            XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
                policy(tcp: [dnsPort], trusted: true)
            ))
        }
        for protectedIP in ["1.1.1.1", "8.8.8.8", "160.79.104.10", "149.154.167.91", "179.253.244.3"] {
            let blockedEndpoint = ConfigPipeline.DirectEndpoint(
                address: protectedIP,
                port: 443,
                transport: "tcp"
            )
            XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
                policy(tcp: [blockedEndpoint], trusted: true)
            ))
            XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
                policy(tcpDirectAddresses: [protectedIP], trusted: true)
            ))
        }
        let overlap = ConfigPipeline.DirectEndpoint(
            address: "81.69.152.51",
            port: 55300,
            transport: "tcp"
        )
        XCTAssertThrowsError(try ConfigPipeline.validatedManagedDirectPolicy(
            policy(tcp: [overlap], tcpDirectAddresses: ["81.69.152.51"], trusted: true)
        ))
    }

    func testUnsignedV5PolicyDecodesNewFieldsAndDropsUnlistedTCPGrants() async throws {
        let json = """
        {
          "version": 5,
          "domains": [],
          "mediaEndpoints": [],
          "tcpEndpoints": [{"address": "139.224.114.71", "ports": [55300]}],
          "webDomains": [],
          "directSuffixes": [],
          "tcpDirectAddresses": ["103.253.207.41", "81.69.152.51"]
        }
        """
        let decoded = try JSONDecoder().decode(TonoTrafficPolicy.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.version, 5)
        XCTAssertEqual(decoded.tcpEndpoints.map(\.ports), [[55300]])
        XCTAssertEqual(decoded.tcpDirectAddresses, ["103.253.207.41", "81.69.152.51"])
        XCTAssertFalse(decoded.trusted)

        let cache = ManagedTrafficPolicyCache(
            revision: 11,
            json: json,
            sha256: ConfigStorage.sha256Base64URL(Data(json.utf8)),
            updatedAt: nil,
            signature: nil
        )
        let validated = try await ManagedTrafficPolicyProcessor().validate(
            cache,
            protectedAddresses: ["203.0.113.1"]
        )
        XCTAssertTrue(validated.tcpEndpoints.isEmpty)
        XCTAssertTrue(validated.tcpDirectAddresses.isEmpty)
    }
}
