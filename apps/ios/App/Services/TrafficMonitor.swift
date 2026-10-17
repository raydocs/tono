import Foundation
import Libbox

/// Reads throughput from sing-box's command server (over the App Group socket) while the tunnel runs.
final class TrafficMonitor: NSObject, LibboxCommandClientHandlerProtocol, @unchecked Sendable {
    private var client: LibboxCommandClient?
    private let queue = DispatchQueue(label: "tono.app.traffic")
    var onRate: (@MainActor (Int64, Int64) -> Void)?

    func start() {
        queue.async { [weak self] in
            guard let self, self.client == nil else { return }
            let options = LibboxCommandClientOptions()
            options.addCommand(LibboxCommandStatus)
            options.statusInterval = Int64(NSEC_PER_SEC)
            let client = LibboxNewCommandClient(self, options)
            do {
                try client?.connect()
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
        Task { @MainActor [onRate] in onRate?(0, 0) }
    }

    func writeStatus(_ message: LibboxStatusMessage?) {
        guard let message, message.trafficAvailable else { return }
        let down = message.downlink, up = message.uplink
        Task { @MainActor [onRate] in onRate?(down, up) }
    }

    func connected() {}
    func disconnected(_ message: String?) { queue.async { [weak self] in self?.client = nil } }
    func clearLogs() {}
    func initializeClashMode(_ modeList: (any LibboxStringIteratorProtocol)?, currentMode: String?) {}
    func setDefaultLogLevel(_ level: Int32) {}
    func updateClashMode(_ newMode: String?) {}
    func writeConnectionEvents(_ events: LibboxConnectionEvents?) {}
    func writeGroups(_ message: (any LibboxOutboundGroupIteratorProtocol)?) {}
    func writeLogs(_ messageList: (any LibboxLogIteratorProtocol)?) {}
    func writeOutbounds(_ message: (any LibboxOutboundGroupItemIteratorProtocol)?) {}
}
