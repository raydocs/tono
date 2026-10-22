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

    @MainActor
    func testDisconnectClearsRatesAndRecoversWithoutRestartingTheTunnel() async throws {
        let h = Harness()
        h.monitor.start()
        h.drain()
        let old = h.clients[0]
        old.receive(.rate(90, 20))
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 90)
        old.receive(.disconnected)
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 0)
        XCTAssertEqual(h.rates.last?.1, 0)
        XCTAssertEqual(old.disconnects, 1)
        XCTAssertEqual(h.clock.pending.count, 1)
        guard h.clock.pending.count == 1 else { return }
        h.clock.fireNext()
        h.drain()
        XCTAssertEqual(h.clients.count, 2)
        h.clients[1].receive(.rate(300, 40))
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 300)
        h.monitor.stop()
        h.drain()
    }

    @MainActor
    func testRepeatedFailuresBackOffToThirtySecondsAndOnlyDataResetsTheDelay() async throws {
        let h = Harness()
        h.failNext = true
        h.monitor.start()
        h.drain()
        for attempt in 0..<8 {
            XCTAssertEqual(h.clock.pending.count, 1)
            guard h.clock.pending.count == 1 else { return }
            XCTAssertEqual(h.clock.pending[0].delay, min(pow(2, Double(attempt)), 30))
            h.failNext = true
            h.clock.fireNext()
            h.drain()
            XCTAssertEqual(h.clients.count, attempt + 2)
        }
        h.clock.fireNext() // Successful connect without data must not reset flapping backoff.
        h.drain()
        h.clients.last?.receive(.disconnected)
        h.drain()
        XCTAssertEqual(h.clock.pending.first?.delay, 30)
        guard !h.clock.pending.isEmpty else { return }
        h.clock.fireNext()
        h.drain()
        h.clients.last?.receive(.rate(1, 2))
        h.drain()
        h.clients.last?.receive(.disconnected)
        h.drain()
        XCTAssertEqual(h.clock.pending.first?.delay, 1)
        h.monitor.stop()
        h.drain()
    }

    @MainActor
    func testStopCancelsRetryEvenIfItsTimerAlreadyEscapedCancellation() async throws {
        let h = Harness()
        h.failNext = true
        h.monitor.start()
        h.drain()
        let timer = try XCTUnwrap(h.clock.pending.first)
        h.monitor.stop()
        h.drain()
        XCTAssertTrue(timer.cancelled)
        timer.work() // A cancelled work item may already have entered the dispatch queue.
        h.drain()
        XCTAssertEqual(h.clients.count, 1)
        XCTAssertEqual(h.rates.last?.0, 0)
    }

    @MainActor
    func testOldClientsAndQueuedRatesCannotOverwriteAReplacementSession() async throws {
        let h = Harness()
        h.monitor.start()
        h.drain()
        let old = h.clients[0]
        old.receive(.rate(999, 888))
        h.flushWorker() // Leave the old delivery queued for the main actor.
        h.monitor.stop() // Sign-out/session replacement invalidates it synchronously.
        h.monitor.start()
        h.drain()
        XCTAssertFalse(h.rates.contains { $0.0 == 999 })
        XCTAssertEqual(h.clients.count, 2)
        h.clients[1].receive(.rate(70, 8))
        h.drain()
        old.receive(.disconnected)
        old.receive(.rate(777, 666))
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 70)
        XCTAssertTrue(h.clock.pending.isEmpty)
        XCTAssertEqual(h.clients[1].disconnects, 0)
        h.monitor.stop()
        h.drain()
    }

    @MainActor
    func testNewConnectedDateReplacesTheStatisticsSessionWithoutAnIntermediateStop() async throws {
        let h = Harness()
        let first = Date(timeIntervalSince1970: 1)
        h.monitor.start(session: first)
        h.drain()
        let old = h.clients[0]
        old.receive(.rate(999, 888))
        h.flushWorker()
        h.monitor.start(session: first.addingTimeInterval(1))
        h.drain()
        XCTAssertEqual(h.clients.count, 2)
        XCTAssertEqual(old.disconnects, 1)
        XCTAssertFalse(h.rates.contains { $0.0 == 999 })
        old.receive(.disconnected)
        h.drain()
        XCTAssertTrue(h.clock.pending.isEmpty)
        h.monitor.stop()
        h.drain()
    }

    @MainActor
    func testQueuedRateBeforeSocketFailureCannotReappearAfterTheClear() async throws {
        let h = Harness()
        h.monitor.start()
        h.drain()
        h.clients[0].receive(.rate(999, 888))
        h.flushWorker()
        let obsolete = h.deliveries
        h.deliveries = []
        h.clients[0].receive(.disconnected)
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 0)
        obsolete.forEach { $0() } // Deliver deliberately out of order.
        XCTAssertEqual(h.rates.last?.0, 0)
        h.monitor.stop()
        h.drain()
    }

    @MainActor
    func testDuplicateStartDoesNotBypassAnOutstandingRetry() async throws {
        let h = Harness()
        h.failNext = true
        h.monitor.start()
        h.drain()
        h.monitor.start()
        h.monitor.start()
        h.drain()
        XCTAssertEqual(h.clients.count, 1)
        XCTAssertEqual(h.clock.pending.count, 1)
        h.monitor.stop()
        h.drain()
    }

    @MainActor
    func testStopWhileConnectIsInFlightDiscardsItsLateSuccess() async throws {
        let h = Harness()
        let entered = DispatchSemaphore(value: 0)
        let finish = DispatchSemaphore(value: 0)
        h.onConnect = { entered.signal(); finish.wait() }
        h.monitor.start()
        XCTAssertEqual(entered.wait(timeout: .now() + 5), .success)
        h.monitor.stop()
        finish.signal()
        h.drain()
        XCTAssertEqual(h.clients.count, 1)
        XCTAssertEqual(h.clients[0].disconnects, 1)
        h.clients[0].receive(.rate(999, 888))
        h.clients[0].receive(.disconnected)
        h.drain()
        XCTAssertEqual(h.rates.last?.0, 0)
        XCTAssertTrue(h.clock.pending.isEmpty)
    }

}

private final class Client: TrafficClient {
    let receive: @Sendable (TrafficEvent) -> Void
    var fails: Bool
    var disconnects = 0
    var onConnect: (() -> Void)?
    init(fails: Bool, receive: @escaping @Sendable (TrafficEvent) -> Void) {
        self.fails = fails
        self.receive = receive
    }
    func connect() throws { onConnect?(); if fails { throw CocoaError(.fileReadUnknown) } }
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
    var onConnect: (() -> Void)?
    var deliveries: [@MainActor @Sendable () -> Void] = []
    var rates: [(Int64, Int64)] = []
    @MainActor lazy var monitor: TrafficMonitor = {
        let monitor = TrafficMonitor(queue: queue, makeClient: { [unowned self] receive in
            let client = Client(fails: self.failNext, receive: receive)
            client.onConnect = self.onConnect
            self.failNext = false
            self.clients.append(client)
            return client
        }, schedule: { [unowned self] in self.clock.schedule($0, $1) },
           deliver: { [unowned self] in self.deliveries.append($0) })
        monitor.onRate = { [unowned self] in self.rates.append(($0, $1)) }
        return monitor
    }()
    func flushWorker() {
        // The second barrier drains callbacks emitted synchronously by connect/disconnect.
        queue.sync {}
        queue.sync {}
    }
    @MainActor func drain() {
        flushWorker()
        let ready = deliveries
        deliveries = []
        ready.forEach { $0() }
    }
}
