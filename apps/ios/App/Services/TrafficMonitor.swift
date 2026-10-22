import Foundation
import Libbox

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

/// Reads statistics only; neither a socket connection nor a rate certifies tunnel protection.
@MainActor
final class TrafficMonitor {
    private let worker: TrafficWorker
    private let deliver: TrafficDelivery
    private var run: TrafficLifetime?
    private var session: Date?
    var onRate: ((Int64, Int64) -> Void)?

    init(queue: DispatchQueue = DispatchQueue(label: "tono.app.traffic"),
         makeClient: @escaping TrafficClientFactory = { LibboxTrafficClient(receive: $0) },
         schedule: @escaping TrafficScheduler = trafficSchedule,
         deliver: @escaping TrafficDelivery = { work in Task { @MainActor in work() } }) {
        worker = TrafficWorker(queue: queue, makeClient: makeClient, schedule: schedule)
        self.deliver = deliver
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

/// One handler per native client: its callbacks never acquire another client's identity.
private final class LibboxTrafficClient: NSObject, TrafficClient, LibboxCommandClientHandlerProtocol {
    private let receive: @Sendable (TrafficEvent) -> Void
    private var client: LibboxCommandClient?

    init(receive: @escaping @Sendable (TrafficEvent) -> Void) {
        self.receive = receive
        super.init()
        let options = LibboxCommandClientOptions()
        options.addCommand(LibboxCommandStatus)
        options.statusInterval = Int64(NSEC_PER_SEC)
        client = LibboxNewCommandClient(self, options)
    }

    func connect() throws {
        guard let client else { throw CocoaError(.coderInvalidValue) }
        try client.connect()
    }
    func disconnect() throws {
        let client = self.client
        self.client = nil
        try client?.disconnect()
    }
    func writeStatus(_ message: LibboxStatusMessage?) {
        guard let message, message.trafficAvailable else { return }
        receive(.rate(message.downlink, message.uplink))
    }
    func connected() {}
    func disconnected(_ message: String?) { receive(.disconnected) }
    func clearLogs() {}
    func initializeClashMode(_ modeList: (any LibboxStringIteratorProtocol)?, currentMode: String?) {}
    func setDefaultLogLevel(_ level: Int32) {}
    func updateClashMode(_ newMode: String?) {}
    func write(_ events: LibboxConnectionEvents?) {}
    func writeGroups(_ message: (any LibboxOutboundGroupIteratorProtocol)?) {}
    func writeLogs(_ messageList: (any LibboxLogIteratorProtocol)?) {}
    func writeOutbounds(_ message: (any LibboxOutboundGroupItemIteratorProtocol)?) {}
}
