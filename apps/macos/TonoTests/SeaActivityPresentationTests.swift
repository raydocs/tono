import XCTest
@testable import Tono

final class SeaActivityPresentationTests: XCTestCase {
    @MainActor
    func testExpandedConnectionsAreBoundedToTwentyMatchingCurrentEntries() {
        let entries = (0..<30).map { index in
            ConnectionEntry(
                id: "\(index)", domain: "host\(index).example", protocolName: "tcp",
                rule: "MATCH", nodeFlag: "", nodeName: "Exit", latency: nil,
                dataSize: "0 B", dataLabel: "", timestamp: "", type: .proxied,
                processName: index == 0 ? "Other" : "App"
            )
        }
        let displayed = SeaActivityPresentation.currentConnections(entries, for: "App")
        XCTAssertEqual(displayed.count, 20)
        XCTAssertEqual(displayed.first?.id, "1")
        XCTAssertEqual(displayed.last?.id, "20")
    }
}
