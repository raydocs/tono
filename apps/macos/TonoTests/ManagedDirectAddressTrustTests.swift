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
        trusted: Bool
    ) -> ConfigPipeline.ManagedDirectRuntimePolicy {
        ConfigPipeline.ManagedDirectRuntimePolicy(
            physicalInterface: "en0",
            domainPins: [],
            webDomainPins: [],
            webDomainSuffixes: [],
            mediaEndpoints: media,
            tcpEndpoints: tcp,
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
}
