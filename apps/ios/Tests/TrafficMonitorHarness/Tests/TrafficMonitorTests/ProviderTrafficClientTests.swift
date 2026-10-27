import Foundation
import XCTest
import TonoKit
@testable import TrafficMonitor

/// The app's statistics over `TunnelMessage.traffic`: the production client and monitor, with the
/// provider message and the clock in the test's hands.
final class ProviderTrafficClientTests: XCTestCase {
    func testOneAskAtATimeAndARefusalEndsTheStream() throws {
        let tunnel = FakeTunnel(), clock = Ticks(), events = Events()
        let client = ProviderTrafficClient(receive: events.add, ask: tunnel.ask, schedule: clock.schedule)
        try client.connect()
        XCTAssertEqual(tunnel.asks.count, 1)
        tunnel.reply(TrafficSample(down: 2_000, up: 30).encoded)
        XCTAssertEqual(events.all, [.rate(2_000, 30)])
        XCTAssertEqual(tunnel.asks.count, 1, "the next ask waits for the tick, not the reply")
        clock.fire()
        XCTAssertEqual(tunnel.asks.count, 2)
        // An extension from before this message, a timeout (nil) and "unavailable" all end the stream.
        tunnel.reply(Data("unknown message".utf8))
        XCTAssertEqual(events.all.last, .disconnected)
        XCTAssertTrue(clock.pending.isEmpty, "no tick after the stream ended")
    }

    func testDisconnectDropsALateReplyAndCancelsTheTick() throws {
        let tunnel = FakeTunnel(), clock = Ticks(), events = Events()
        let client = ProviderTrafficClient(receive: events.add, ask: tunnel.ask, schedule: clock.schedule)
        try client.connect()
        tunnel.reply(TrafficSample(down: 1, up: 1).encoded)
        try client.disconnect()
        XCTAssertTrue(clock.pending.isEmpty)
        try client.connect()
        let lateFromFirstStream = tunnel.asks[0]
        lateFromFirstStream(TrafficSample(down: 999, up: 999).encoded)
        XCTAssertEqual(events.all, [.rate(1, 1)], "a reply to an earlier stream never reaches the screen")
        tunnel.reply(nil)
        XCTAssertEqual(events.all, [.rate(1, 1), .disconnected])
    }
}

private final class FakeTunnel: @unchecked Sendable {
    var asks: [@Sendable (Data?) -> Void] = []
    var ask: TrafficAsk { { [unowned self] in self.asks.append($0) } }
    func reply(_ data: Data?) { asks.last?(data) }
}

private final class Events: @unchecked Sendable {
    var all: [Event] = []
    var add: @Sendable (TrafficEvent) -> Void {
        { [unowned self] in
            switch $0 {
            case .rate(let d, let u): self.all.append(.rate(d, u))
            case .disconnected: self.all.append(.disconnected)
            }
        }
    }
    enum Event: Equatable { case rate(Int64, Int64), disconnected }
}

private final class Ticks: @unchecked Sendable {
    final class Tick { let work: @Sendable () -> Void; var cancelled = false; init(_ w: @escaping @Sendable () -> Void) { work = w } }
    private var ticks: [Tick] = []
    var pending: [Tick] { ticks.filter { !$0.cancelled } }
    var schedule: TrafficScheduler {
        { [unowned self] _, work in
            let tick = Tick(work)
            self.ticks.append(tick)
            return { tick.cancelled = true }
        }
    }
    func fire() {
        guard let tick = pending.first else { return XCTFail("no tick pending") }
        tick.cancelled = true
        tick.work()
    }
}
