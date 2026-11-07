import Foundation
import TonoKit

protocol TrafficClient: AnyObject {
    func connect() throws
    func disconnect() throws
}

enum TrafficEvent: Sendable {
    case rate(Int64, Int64)
    case disconnected
}

typealias TrafficClientFactory = (@escaping @Sendable (TrafficEvent) -> Void) -> any TrafficClient
typealias TrafficScheduler = (TimeInterval, @escaping @Sendable () -> Void) -> () -> Void
typealias TrafficDelivery = (@escaping @MainActor @Sendable () -> Void) -> Void
/// Sends `TunnelMessage.traffic` to the running tunnel; the handler gets its reply, or nil for none.
typealias TrafficAsk = @Sendable (@escaping @Sendable (Data?) -> Void) -> Void

/// Reads statistics only; neither a socket connection nor a rate certifies tunnel protection.
@MainActor
final class TrafficMonitor {
    private let worker: TrafficWorker
    private let deliver: TrafficDelivery
    private var run: TrafficLifetime?
    private var session: Date?
    private var statisticsStartEpoch: UInt64?
    var onRate: ((Int64, Int64) -> Void)?

    init(queue: DispatchQueue = DispatchQueue(label: "tono.app.traffic"),
         makeClient: @escaping TrafficClientFactory,
         schedule: @escaping TrafficScheduler = trafficSchedule,
         deliver: @escaping TrafficDelivery = { work in Task { @MainActor in work() } }) {
        worker = TrafficWorker(queue: queue, makeClient: makeClient, schedule: schedule)
        self.deliver = deliver
    }

    /// AppModel's statistics boundary, separate from tunnel/protection state. Kept here so tests
    /// exercise the production path from NE status and shared lifecycle intent to the real worker.
    func updateTunnel(_ status: TunnelStatus, session: Date?, eligible: Bool, startEpoch: UInt64?) {
        // An explicit stop stays closed across disconnected/invalid/load/late-connected events.
        // Only another shared explicit start (app or outside command) releases it. Epoch zero
        // inherits a running tunnel on first load; On Demand retains the last permitted epoch.
        guard status == .connected, eligible, let startEpoch else { stop(); return }
        if statisticsStartEpoch != startEpoch {
            stop() // Even an unchanged NE date cannot carry callbacks across explicit starts.
            statisticsStartEpoch = startEpoch
        }
        start(session: session)
    }

    /// Repeated NE connected notifications do not bypass backoff. A new connected date belongs
    /// to another session, even if NE did not deliver an intervening disconnected notification.
    func start(session: Date? = nil) {
        if run != nil {
            guard self.session != session else { return }
            stop()
        }
        self.session = session
        let run = TrafficLifetime()
        self.run = run
        let deliver = self.deliver
        worker.start(run) { [weak self] down, up, receipt in
            deliver { [weak self] in
                guard let self, self.run === run, run.isActive, receipt.isActive else { return }
                self.onRate?(down, up)
            }
        }
    }

    func stop() {
        // Synchronous main-actor invalidation: queued rates/timers cannot outlive sign-out or stop,
        // including while the serial worker is still inside native connect().
        run?.cancel()
        run = nil
        session = nil
        worker.stop()
        onRate?(0, 0)
    }

    deinit {
        run?.cancel()
        worker.stop()
    }
}

/// Shared only for invalidation across the main actor and the worker. All client/retry state
/// stays on the worker's serial queue; native connect/disconnect never block the main actor.
private final class TrafficLifetime: @unchecked Sendable {
    private let lock = NSLock()
    private var active = true
    var isActive: Bool { lock.lock(); defer { lock.unlock() }; return active }
    func cancel() { lock.lock(); active = false; lock.unlock() }
}

private final class TrafficWorker: @unchecked Sendable {
    private let queue: DispatchQueue
    private let makeClient: TrafficClientFactory
    private let schedule: TrafficScheduler
    private var run: TrafficLifetime?
    private var client: (any TrafficClient)?
    private var attempt: UUID?
    private var retry: UUID?
    private var cancelRetry: (() -> Void)?
    private var delay: TimeInterval = 1
    private var receipt: TrafficLifetime?
    private var onRate: (@Sendable (Int64, Int64, TrafficLifetime) -> Void)?

    init(queue: DispatchQueue, makeClient: @escaping TrafficClientFactory,
         schedule: @escaping TrafficScheduler) {
        self.queue = queue
        self.makeClient = makeClient
        self.schedule = schedule
    }

    func start(_ run: TrafficLifetime,
               onRate: @escaping @Sendable (Int64, Int64, TrafficLifetime) -> Void) {
        queue.async {
            guard run.isActive else { return }
            self.retire()
            self.run = run
            self.onRate = onRate
            self.delay = 1
            self.open(run)
        }
    }

    func stop() {
        queue.async {
            self.run = nil
            self.onRate = nil
            self.retire()
        }
    }

    private func retire() {
        retry = nil
        cancelRetry?()
        cancelRetry = nil
        receipt?.cancel()
        receipt = nil
        closeClient()
    }

    private func closeClient() {
        // Invalidate before disconnect, which is allowed to invoke its handler synchronously.
        attempt = nil
        let old = client
        client = nil
        try? old?.disconnect()
    }

    private func open(_ run: TrafficLifetime) {
        guard self.run === run, run.isActive else { return }
        let id = UUID()
        attempt = id
        let client = makeClient { [weak self] event in
            guard let self else { return }
            self.queue.async { [weak self] in
                guard let self, self.run === run, run.isActive, self.attempt == id else { return }
                switch event {
                case .rate(let down, let up):
                    self.delay = 1 // Fresh data, not merely connect(), ends failure backoff.
                    self.publish(down, up)
                case .disconnected:
                    self.failed(run)
                }
            }
        }
        self.client = client
        do {
            try client.connect()
            if !run.isActive { closeClient() }
        } catch {
            failed(run)
        }
    }

    private func failed(_ run: TrafficLifetime) {
        closeClient()
        guard self.run === run, run.isActive, retry == nil else { return }
        publish(0, 0)
        let id = UUID()
        retry = id
        let wait = delay
        delay = min(delay * 2, 30)
        cancelRetry = schedule(wait) { [weak self] in
            guard let self else { return }
            self.queue.async { [weak self] in
                guard let self, self.run === run, run.isActive, self.retry == id else { return }
                self.retry = nil
                self.cancelRetry = nil
                self.open(run)
            }
        }
    }

    private func publish(_ down: Int64, _ up: Int64) {
        // Even deliveries already enqueued on the main actor must not restore an obsolete rate
        // after a disconnect's zero, or overwrite a newer sample delivered out of order.
        receipt?.cancel()
        let receipt = TrafficLifetime()
        self.receipt = receipt
        onRate?(down, up, receipt)
    }
}

func trafficSchedule(_ delay: TimeInterval, _ work: @escaping @Sendable () -> Void) -> () -> Void {
    let item = DispatchWorkItem(block: work)
    DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: item)
    return { item.cancel() }
}

/// Asks the tunnel for a sample once a second (`TunnelMessage.traffic`), never with an ask still
/// out. The tunnel reads its own core, so the app links no libbox. No reply (the message's timeout),
/// an "unavailable" or anything else that is not a sample ends the stream as a lost socket did: the
/// monitor clears the rate, backs off and asks again.
final class ProviderTrafficClient: TrafficClient, @unchecked Sendable {
    private let receive: @Sendable (TrafficEvent) -> Void
    private let ask: TrafficAsk
    private let schedule: TrafficScheduler
    private let interval: TimeInterval
    private let lock = NSLock()
    /// Bumped by connect and disconnect: a reply or tick of an earlier stream does nothing.
    private var generation = 0
    private var cancelTick: (() -> Void)?

    init(receive: @escaping @Sendable (TrafficEvent) -> Void, ask: @escaping TrafficAsk,
         interval: TimeInterval = 1, schedule: @escaping TrafficScheduler = trafficSchedule) {
        self.receive = receive
        self.ask = ask
        self.interval = interval
        self.schedule = schedule
    }

    func connect() throws {
        poll(advance())
    }

    func disconnect() throws {
        _ = advance()
    }

    private func advance() -> Int {
        lock.lock()
        defer { lock.unlock() }
        generation += 1
        cancelTick?()
        cancelTick = nil
        return generation
    }

    private func current(_ g: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return generation == g
    }

    private func poll(_ g: Int) {
        guard current(g) else { return }
        ask { [weak self] data in
            guard let self, self.current(g) else { return }
            guard let sample = TrafficSample.decode(data) else {
                _ = self.advance()
                self.receive(.disconnected)
                return
            }
            self.receive(.rate(sample.down, sample.up))
            self.lock.lock()
            defer { self.lock.unlock() }
            guard self.generation == g else { return }
            self.cancelTick = self.schedule(self.interval) { [weak self] in self?.poll(g) }
        }
    }
}
