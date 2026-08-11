import XCTest
@testable import Tono

final class SubscriptionURLPolicyTests: XCTestCase {
    private func rejection(_ raw: String) -> SubscriptionURLPolicy.Rejection? {
        guard case .failure(let rejection) = SubscriptionURLPolicy.validate(raw) else {
            return nil
        }
        return rejection
    }

    private func accepted(_ raw: String) -> URL? {
        guard case .success(let url) = SubscriptionURLPolicy.validate(raw) else {
            return nil
        }
        return url
    }

    func testAcceptsPublicHTTPSOrigins() {
        for raw in [
            "https://subscriptions.example.com/path?token=secret",
            "https://8.8.8.8/subscription",
            "https://[2606:4700:4700::1111]/subscription",
            "https://xn--bcher-kva.example/subscription",
        ] {
            XCTAssertNotNil(accepted(raw), "expected \(raw) to be accepted")
        }
    }

    func testNormalizesSchemeCaseAndTrailingDotWhilePreservingQuery() {
        let url = accepted("HTTPS://EXAMPLE.COM.:443/subscription?token=abc")
        XCTAssertEqual(url?.scheme, "https")
        XCTAssertEqual(url?.host, "example.com")
        XCTAssertEqual(url?.query, "token=abc")
    }

    func testPreservesIPv6LiteralBrackets() {
        let url = accepted("https://[2606:4700:4700::1111]/subscription")
        XCTAssertEqual(url?.host, "2606:4700:4700::1111")
        XCTAssertEqual(
            url?.absoluteString,
            "https://[2606:4700:4700::1111]/subscription"
        )
    }

    func testRejectsUnparseableInput() {
        XCTAssertEqual(rejection(""), .invalidURL)
        XCTAssertEqual(rejection("not a URL"), .invalidURL)
    }

    func testRejectsNonHTTPSSchemes() {
        XCTAssertEqual(rejection("http://example.com/subscription"), .schemeNotHTTPS)
        XCTAssertEqual(rejection("ftp://example.com/subscription"), .schemeNotHTTPS)
    }

    func testRejectsEmbeddedCredentials() {
        XCTAssertEqual(
            rejection("https://user:password@example.com/subscription"),
            .credentialsNotAllowed
        )
    }

    func testRejectsPortsOtherThan443() {
        XCTAssertEqual(rejection("https://example.com:8443/subscription"), .blockedPort(8443))
        XCTAssertEqual(rejection("https://example.com:80/subscription"), .blockedPort(80))
    }

    func testRejectsLoopbackAndInternalSuffixes() {
        XCTAssertEqual(rejection("https://localhost/subscription"), .blockedHost("localhost"))
        XCTAssertEqual(rejection("https://service.local/subscription"), .blockedHost("service.local"))
        XCTAssertEqual(
            rejection("https://service.internal/subscription"),
            .blockedHost("service.internal")
        )
        XCTAssertEqual(rejection("https://router.lan/subscription"), .blockedHost("router.lan"))
        XCTAssertEqual(
            rejection("https://host.home.arpa/subscription"),
            .blockedHost("host.home.arpa")
        )
        XCTAssertEqual(rejection("https://0.0.0.0/subscription"), .blockedHost("0.0.0.0"))
    }

    func testRejectsMalformedDNSNames() {
        XCTAssertEqual(rejection("https://singlelabel/subscription"), .blockedHost("singlelabel"))
        XCTAssertEqual(rejection("https://-bad.example/subscription"), .blockedHost("-bad.example"))
        XCTAssertEqual(rejection("https://bad-.example/subscription"), .blockedHost("bad-.example"))
        XCTAssertEqual(rejection("https://bad..example/subscription"), .blockedHost("bad..example"))
    }

    func testRejectsPrivateAndReservedIPv4Literals() {
        for address in [
            "0.1.2.3", "10.0.0.1", "100.64.0.1", "100.127.255.254",
            "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
            "192.0.0.1", "192.0.2.1", "192.88.99.1", "192.168.1.1",
            "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1",
            "224.0.0.1", "240.0.0.1", "255.255.255.255",
        ] {
            XCTAssertEqual(
                rejection("https://\(address)/subscription"),
                .blockedAddress(address),
                "expected \(address) to be blocked as an address"
            )
        }
    }

    func testRejectsNonGlobalIPv6Literals() {
        for address in [
            "::ffff:127.0.0.1", "::ffff:169.254.169.254", "::ffff:192.168.1.1",
            "64:ff9b::c0a8:101", "100::1", "2001::1", "2001:db8::1",
            "2002:c0a8:101::1", "3fff::1", "fc00::1", "fd00::1", "fe80::1", "ff02::1",
        ] {
            XCTAssertEqual(
                rejection("https://[\(address)]/subscription"),
                .blockedAddress(address),
                "expected \(address) to be blocked as an address"
            )
        }
        XCTAssertEqual(rejection("https://[::1]/subscription"), .blockedHost("::1"))
        XCTAssertNotNil(rejection("https://[fe80::1%25en0]/subscription"))
    }

    func testIsBlockedIPAcceptsOnlyGlobalUnicast() {
        XCTAssertFalse(SubscriptionURLPolicy.isBlockedIP("8.8.8.8"))
        XCTAssertFalse(SubscriptionURLPolicy.isBlockedIP("2606:4700:4700::1111"))
        XCTAssertTrue(SubscriptionURLPolicy.isBlockedIP("10.1.2.3"))
        XCTAssertTrue(SubscriptionURLPolicy.isBlockedIP("not-an-address"))
    }

    func testLiteralIPAddressOnlyClassifiesLiterals() {
        XCTAssertEqual(SubscriptionURLPolicy.literalIPAddress("8.8.8.8"), "8.8.8.8")
        XCTAssertEqual(SubscriptionURLPolicy.literalIPAddress("[::1]"), "::1")
        XCTAssertNil(SubscriptionURLPolicy.literalIPAddress("example.com"))
    }

    func testRejectionsCarryUserFacingDescriptions() {
        XCTAssertEqual(
            SubscriptionURLPolicy.Rejection.blockedPort(8443).errorDescription,
            "Subscription HTTPS port is not allowed: 8443"
        )
        XCTAssertEqual(
            SubscriptionURLPolicy.Rejection.schemeNotHTTPS.errorDescription,
            "Subscription URLs must use HTTPS."
        )
    }
}
