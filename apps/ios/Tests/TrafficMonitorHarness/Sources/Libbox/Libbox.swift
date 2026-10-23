import Foundation

public protocol LibboxStringIteratorProtocol {}
public protocol LibboxOutboundGroupIteratorProtocol {}
public protocol LibboxLogIteratorProtocol {}
public protocol LibboxOutboundGroupItemIteratorProtocol {}
public final class LibboxConnectionEvents {}
public final class LibboxStatusMessage {
    public var trafficAvailable = true
    public var downlink: Int64 = 0
    public var uplink: Int64 = 0
}
public protocol LibboxCommandClientHandlerProtocol {
    func writeStatus(_ message: LibboxStatusMessage?)
    func connected()
    func disconnected(_ message: String?)
    func clearLogs()
    func initializeClashMode(_ modeList: (any LibboxStringIteratorProtocol)?, currentMode: String?)
    func setDefaultLogLevel(_ level: Int32)
    func updateClashMode(_ newMode: String?)
    func write(_ events: LibboxConnectionEvents?)
    func writeGroups(_ message: (any LibboxOutboundGroupIteratorProtocol)?)
    func writeLogs(_ messageList: (any LibboxLogIteratorProtocol)?)
    func writeOutbounds(_ message: (any LibboxOutboundGroupItemIteratorProtocol)?)
}
public let LibboxCommandStatus: Int32 = 1
public final class LibboxCommandClientOptions {
    public init() {}
    public var statusInterval: Int64 = 0
    public func addCommand(_ command: Int32) {}
}
public final class LibboxCommandClient {
    public func connect() throws { fatalError("Tests must inject a TrafficClient") }
    public func disconnect() throws { fatalError("Tests must inject a TrafficClient") }
}
public func LibboxNewCommandClient(_ handler: any LibboxCommandClientHandlerProtocol,
                                  _ options: LibboxCommandClientOptions) -> LibboxCommandClient? {
    fatalError("Tests must inject a TrafficClient")
}
