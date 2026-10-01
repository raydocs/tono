import XCTest
@testable import Tono

final class ParserPropertyTests: XCTestCase {
    func testGeneratedSubscriptionURLsStayHTTPSWhenAccepted() {
        var state: UInt64 = 0x1234_5678_9abc_def0
        func next() -> UInt64 {
            state = state &* 6_364_136_223_846_793_005 &+ 1
            return state
        }
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789-.")
        for _ in 0..<32 {
            let count = Int(next() % 24)
            var host = ""
            for _ in 0..<count {
                host.append(alphabet[Int(next() % UInt64(alphabet.count))])
            }
            let raw = "https://\(host)/subscription"
            switch SubscriptionURLPolicy.validate(raw) {
            case .success(let url):
                XCTAssertEqual(url.scheme?.lowercased(), "https")
                let parsed = (url.host ?? "").lowercased()
                XCTAssertFalse(parsed == "localhost" || parsed.hasSuffix(".localhost"))
                XCTAssertFalse(parsed.hasSuffix(".local") || parsed.hasSuffix(".internal"))
                XCTAssertFalse(parsed.hasSuffix(".lan") || parsed.hasSuffix(".home.arpa"))
                XCTAssertNil(url.user)
                XCTAssertNil(url.password)
            case .failure:
                break
            }
        }
    }

    func testGeneratedProxyURLsDoNotTrap() {
        var state: UInt64 = 7
        func next() -> UInt64 {
            state = state &* 6_364_136_223_846_793_005 &+ 1
            return state
        }
        let prefixes = ["vless://", "hy2://", "hysteria2://", "trojan://", "ss://", "vmess://", ""]
        let alphabet = Array("abcdefghijklmnopqrstuvwxyz0123456789%:@-._/?#")
        for _ in 0..<32 {
            let prefix = prefixes[Int(next() % UInt64(prefixes.count))]
            var body = ""
            for _ in 0..<Int(next() % 40) {
                body.append(alphabet[Int(next() % UInt64(alphabet.count))])
            }
            let raw = prefix + body
            if let node = ConfigParser.parseProxyURL(raw) {
                XCTAssertGreaterThan(node.port, 0)
            }
            _ = ConfigParser.parseSubscription(raw)
        }
    }
}
