import XCTest
@testable import TonoKit

/// The extension's refused-rebuild path, end to end without libbox: the graph it keeps, the inputs
/// file it leaves, and what its heartbeat then makes widgets and the Control Center switch say.
final class TunnelGraphTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private struct StartRefused: Error {}

    func testRebuildAndRestoreBothRefusedMakeTheHeartbeatSayRoutesStoppedNotConnected() throws {
        let threeTier = TunnelInputs(catalogBody: "catalog", mode: .threeTier, selectedNode: "tokyo-1")
        let stable = TunnelInputs(catalogBody: "catalog", mode: .stable, selectedNode: "tokyo-1")
        var graph = TunnelGraph()
        try graph.run(threeTier, build: { $0.mode.rawValue }, start: { _ in })
        var file = stable
        // libbox refuses every start from here on, so the previous graph cannot come back either.
        let reply = graph.reload(load: { file }, build: { $0.mode.rawValue }, start: { _ in throw StartRefused() },
                                 persist: { file = $0 })
        XCTAssertEqual(reply, .refused(code: "CORE_START", running: nil))
        XCTAssertNil(graph.runningSettings)
        // An On Demand restart reads the file: it holds the graph that last ran, not the refused one.
        XCTAssertEqual(file, threeTier)

        // The app said Connected before the switch; then the extension's heartbeat writes the shared file.
        let app = StatusSnapshot.fromApp(.connected, reason: nil, exit: "Tokyo · Dawn", since: t0, now: t0)
        let beat = graph.heartbeat(since: t0, previous: app, now: t0.addingTimeInterval(300))
        let shared = StatusSnapshot.decode(beat.encoded())
        let reading = StatusReading.read(shared, now: t0.addingTimeInterval(301))
        guard case .fresh = reading else { return XCTFail("heartbeat reading is not fresh: \(reading)") }
        XCTAssertEqual(StatusWording(reading), StatusWording(titleKey: "state_routes_stopped", switchOn: false, action: .retry))
    }
}
