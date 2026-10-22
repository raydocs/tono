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
final class TrafficMonitor: @unchecked Sendable {
    private var client: (any TrafficClient)?
    private let queue: DispatchQueue
    private let makeClient: TrafficClientFactory
    private let schedule: TrafficScheduler
    private let deliver: TrafficDelivery
    var onRate: (@MainActor (Int64, Int64) -> Void)?

    init(queue: DispatchQueue = DispatchQueue(label: "tono.app.traffic"),
         makeClient: @escaping TrafficClientFactory = { LibboxTrafficClient(receive: $0) },
         schedule: @escaping TrafficScheduler = trafficSchedule,
         deliver: @escaping TrafficDelivery = { work in Task { @MainActor in work() } }) {
        self.queue = queue
        self.makeClient = makeClient
        self.schedule = schedule
        self.deliver = deliver
    }

    func start() {
        queue.async { [weak self] in
            guard let self, self.client == nil else { return }
            let client = self.makeClient { [weak self] event in
                switch event {
                case .rate(let down, let up): self?.writeRate(down, up)
                case .disconnected: self?.queue.async { [weak self] in self?.client = nil }
                }
            }
            do {
                try client.connect()
                self.client = client
            } catch {
                self.client = nil
            }
        }
    }

    func stop() {
        queue.async { [weak self] in
            try? self?.client?.disconnect()
            self?.client = nil
        }
        deliver { [onRate] in onRate?(0, 0) }
    }

    private func writeRate(_ down: Int64, _ up: Int64) {
        deliver { [onRate] in onRate?(down, up) }
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
    func disconnect() throws { try client?.disconnect() }
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
