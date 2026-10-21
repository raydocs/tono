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
        var graph = TunnelGraph(session: "s1", opened: t0)
        try graph.run(threeTier, build: { $0.mode.rawValue }, start: { _ in })
        let heardBefore = graph.answer(since: t0, now: t0)
        var file = stable
        // libbox refuses every start from here on, so the previous graph cannot come back either.
        let reply = graph.reload(load: { file }, build: { $0.mode.rawValue }, start: { _ in throw StartRefused() },
                                 persist: { file = $0 })
        XCTAssertEqual(reply, .refused(code: "CORE_START", running: nil))
        XCTAssertNil(graph.runningSettings)
        // An On Demand restart reads the file: it holds the graph that last ran, not the refused one.
        XCTAssertEqual(file, threeTier)

        // The app said Connected before the switch; then the extension's heartbeat writes the shared
        // file, on disk, and a widget process reads it back.
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("tono-graph-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let status = StatusFile(url: dir.appendingPathComponent("status.json"))
        let connected = AppNote(.connected, reason: nil, answer: heardBefore, line: (node: "tokyo-1", name: "Tokyo · Dawn"), now: t0)
        status.update { ($0 ?? SharedStatus()).writingApp(connected) }
        let beat = graph.report(process: true, since: t0, failure: nil, now: t0.addingTimeInterval(300))
        status.update { ($0 ?? SharedStatus()).writingTunnel(beat) }
        let shared = StatusFile(url: status.url).load()
        let reading = shared?.reading(now: t0.addingTimeInterval(301)) ?? .unavailable
        guard case .fresh = reading else { return XCTFail("heartbeat reading is not fresh: \(reading)") }
        XCTAssertEqual(StatusWording(reading), StatusWording(titleKey: "state_routes_stopped", switchOn: false, action: .retry))
    }

    /// sing-box stopped its own service: the stop is written at once, before iOS gets round to the
    /// cancellation, and no beat or status reply until the process ends says a graph runs.
    func testACoreStopIsReportedAtOnceAndNoLaterBeatOrReplySaysItRuns() throws {
        var graph = TunnelGraph(session: "s1", opened: t0)
        try graph.run(TunnelInputs(catalogBody: "catalog", mode: .threeTier, selectedNode: "tokyo-1"), build: { $0.mode.rawValue }, start: { _ in })
        var shared = try XCTUnwrap(SharedStatus().writingTunnel(graph.report(process: true, since: t0, failure: nil, now: t0)))
        let dropped = StatusWording(titleKey: "state_dropped", switchOn: false, action: .retry)
        let stop = graph.report(process: false, since: t0, failure: "CORE_STOPPED", now: t0.addingTimeInterval(1), coreStopped: "CORE_STOPPED")
        shared = try XCTUnwrap(shared.writingTunnel(stop))
        XCTAssertEqual(StatusWording(shared.reading(now: t0.addingTimeInterval(2))), dropped)
        // The heartbeat still fires until the process ends.
        let beat = graph.report(process: true, since: t0, failure: nil, now: t0.addingTimeInterval(300), coreStopped: "CORE_STOPPED")
        shared = shared.writingTunnel(beat) ?? shared
        XCTAssertEqual(StatusWording(shared.reading(now: t0.addingTimeInterval(301))), dropped)
        var tracker = ConfirmationTracker()
        tracker.received(graph.answer(since: t0, now: t0.addingTimeInterval(2), coreStopped: "CORE_STOPPED"), ticket: tracker.ask())
        XCTAssertEqual(tracker.confirmation(now: t0.addingTimeInterval(3)), .noGraph)
    }
}
