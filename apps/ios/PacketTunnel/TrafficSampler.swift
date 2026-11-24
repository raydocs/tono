import Foundation
import Libbox
import TonoKit

/// Answers `TunnelMessage.traffic` from this process's own command server, so the app does not link
/// a second copy of libbox just to read statistics. The statistics client runs only while the app
/// keeps asking (`TrafficDemand`): five seconds after the last ask (the app went to the background,
/// was closed or suspended) it is closed. Statistics only; nothing here touches the tunnel.
final class TrafficSampler: @unchecked Sendable {
    /// Owns `stream`, `latest` and `demand`.
    private let queue = DispatchQueue(label: "tono.tunnel.traffic")
    private var stream: Stream?
    private var latest: TrafficSample?
    private var demand = TrafficDemand()
    private var idleCheck: DispatchSourceTimer?
    /// Set when the tunnel stops: a late ask never opens a client against a closing server.
    private var stopped = false

    /// The reply to `TunnelMessage.traffic`: the latest sample, zero while the first is on its way,
    /// or `TrafficSample.unavailable` when the command server cannot be read.
    func sample() async -> Data {
        await withCheckedContinuation { continuation in
            queue.async {
                self.demand.asked(at: ProcessInfo.processInfo.systemUptime)
                if self.stream == nil, !self.stopped { self.open() }
                guard self.stream != nil else { return continuation.resume(returning: TrafficSample.unavailable) }
                continuation.resume(returning: (self.latest ?? TrafficSample(down: 0, up: 0)).encoded)
            }
        }
    }

    /// The tunnel is stopping: close the client before the command server goes.
    func stop() {
        queue.sync { stopped = true; close() }
    }

    private func open() {
        let stream = Stream(owner: self)
        let options = LibboxCommandClientOptions()
        options.addCommand(LibboxCommandStatus)
        options.statusInterval = Int64(NSEC_PER_SEC)
        guard let client = LibboxNewCommandClient(stream, options) else { return }
        stream.client = client
        self.stream = stream
        do {
            try client.connect()
        } catch {
            close()
            return
        }
        latest = nil
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now() + TrafficDemand.idle, repeating: TrafficDemand.idle, leeway: .seconds(1))
        timer.setEventHandler { [weak self] in
            guard let self, self.demand.expired(at: ProcessInfo.processInfo.systemUptime) else { return }
            self.close()
        }
        timer.resume()
        idleCheck = timer
    }

    private func close() {
        idleCheck?.cancel()
        idleCheck = nil
        // Invalidate before disconnect, which may call `disconnected` synchronously.
        let old = stream
        stream = nil
        latest = nil
        try? old?.client?.disconnect()
        old?.client = nil
    }

    fileprivate func received(_ sample: TrafficSample, from source: Stream) {
        queue.async { if self.stream === source { self.latest = sample } }
    }

    fileprivate func lost(_ source: Stream) {
        queue.async { if self.stream === source { self.close() } }
    }

    /// One handler per native client: a late callback of a closed client never reaches a newer one.
    fileprivate final class Stream: NSObject, LibboxCommandClientHandlerProtocol, @unchecked Sendable {
        weak var owner: TrafficSampler?
        var client: LibboxCommandClient?

        init(owner: TrafficSampler) { self.owner = owner }

        func writeStatus(_ message: LibboxStatusMessage?) {
            guard let message, message.trafficAvailable else { return }
            owner?.received(TrafficSample(down: max(message.downlink, 0), up: max(message.uplink, 0)), from: self)
        }
        func disconnected(_ message: String?) { owner?.lost(self) }
        func connected() {}
        func clearLogs() {}
        func initializeClashMode(_ modeList: (any LibboxStringIteratorProtocol)?, currentMode: String?) {}
        func setDefaultLogLevel(_ level: Int32) {}
        func updateClashMode(_ newMode: String?) {}
        func write(_ events: LibboxConnectionEvents?) {}
        func writeGroups(_ message: (any LibboxOutboundGroupIteratorProtocol)?) {}
        func writeLogs(_ messageList: (any LibboxLogIteratorProtocol)?) {}
        func writeOutbounds(_ message: (any LibboxOutboundGroupItemIteratorProtocol)?) {}
    }
}
