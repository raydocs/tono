import Foundation
import XCTest
@testable import TrafficMonitor

final class TrafficMonitorTests: XCTestCase {
    @MainActor
    func testConnectFailureRetriesWithoutAnotherTunnelStatus() async throws {
        let h = Harness()
        h.failNext = true
        h.monitor.start()
        h.drain()
        XCTAssertEqual(h.clients.count, 1)
        XCTAssertEqual(h.clock.pending.count, 1, "A healthy tunnel emits no new connected status: the failed statistics socket must schedule recovery")
        guard h.clock.pending.count == 1 else { return }
        XCTAssertEqual(h.clock.pending[0].delay, 1)
        h.clock.fireNext()
        h.drain()
        XCTAssertEqual(h.clients.count, 2)
        h.clients[1].receive(.rate(120, 30))
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 120)
        XCTAssertEqual(h.rates.last?.1, 30)
        h.monitor.stop()
        h.drain()
    }
}

private final class Client: TrafficClient {
    let receive: @Sendable (TrafficEvent) -> Void
    var fails: Bool
    var disconnects = 0
    init(fails: Bool, receive: @escaping @Sendable (TrafficEvent) -> Void) {
        self.fails = fails
        self.receive = receive
    }
    func connect() throws { if fails { throw CocoaError(.fileReadUnknown) } }
    func disconnect() throws { disconnects += 1; receive(.disconnected) }
}

private final class Clock {
    final class Timer {
        let delay: TimeInterval
        let work: @Sendable () -> Void
        var cancelled = false
        init(_ delay: TimeInterval, _ work: @escaping @Sendable () -> Void) { self.delay = delay; self.work = work }
    }
    var pending: [Timer] = []
    func schedule(_ delay: TimeInterval, _ work: @escaping @Sendable () -> Void) -> () -> Void {
        let timer = Timer(delay, work)
        pending.append(timer)
        return { timer.cancelled = true }
    }
    func fireNext() { pending.removeFirst().work() }
}

private final class Harness: @unchecked Sendable {
    let queue = DispatchQueue(label: "traffic.test")
    let clock = Clock()
    var clients: [Client] = []
    var failNext = false
    var deliveries: [@MainActor @Sendable () -> Void] = []
    var rates: [(Int64, Int64)] = []
    @MainActor lazy var monitor: TrafficMonitor = {
        let monitor = TrafficMonitor(queue: queue, makeClient: { [unowned self] receive in
            let client = Client(fails: self.failNext, receive: receive)
            self.failNext = false
            self.clients.append(client)
            return client
        }, schedule: { [unowned self] in self.clock.schedule($0, $1) },
           deliver: { [unowned self] in self.deliveries.append($0) })
        monitor.onRate = { [unowned self] in self.rates.append(($0, $1)) }
        return monitor
    }()
    @MainActor func drain() {
        // The second barrier drains callbacks emitted synchronously by connect/disconnect.
        queue.sync {}
        queue.sync {}
        let ready = deliveries
        deliveries = []
        ready.forEach { $0() }
    }
}
