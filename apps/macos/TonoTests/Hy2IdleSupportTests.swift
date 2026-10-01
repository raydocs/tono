import XCTest
@testable import Tono

final class Hy2IdleSupportTests: XCTestCase {
    func testMihomoHy2YamlDoesNotInventAKeepaliveKey() throws {
        let yaml = try ConfigPipeline.ownedNodeYAML(Fixture.hy2Node())
        XCTAssertTrue(yaml.contains("type: hysteria2"))
        XCTAssertFalse(yaml.contains("keep-alive"))
        XCTAssertFalse(yaml.contains("keepalive"))
        XCTAssertFalse(yaml.contains("idle-timeout"))
        XCTAssertFalse(yaml.contains("handshake-timeout"))
        XCTAssertFalse(yaml.contains("skip-cert-verify"))
    }

    func testQuicIdleTextGainsTheHy2SupportCodeOnce() {
        let raw = "timeout: no recent network activity"
        let annotated = Hy2IdleSupport.annotate(raw)
        XCTAssertEqual(annotated, "\(Hy2IdleSupport.supportCode): \(raw)")
        XCTAssertEqual(Hy2IdleSupport.annotate(annotated), annotated)
        XCTAssertTrue(Hy2IdleSupport.isQuicIdle("IdleTimeout"))
        XCTAssertEqual(Hy2IdleSupport.annotate("dial tcp: i/o timeout"), "dial tcp: i/o timeout")
        XCTAssertFalse(Hy2IdleSupport.userMessage.localizedCaseInsensitiveContains("switch"))
        XCTAssertFalse(Hy2IdleSupport.userMessage.localizedCaseInsensitiveContains("换"))
    }
}
