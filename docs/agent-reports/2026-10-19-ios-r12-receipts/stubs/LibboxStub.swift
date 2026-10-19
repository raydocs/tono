// Scratch stub: Swift-imported shape of Libbox.objc.h (gobind, sing-box 25b0d5ea, ios tags) for
// the APIs Tono touches. Hand-translated with ObjC import rules: BOOL+NSError** → throws,
// id<P> → (any PProtocol)?, nullable object + NSError** → throws -> non-optional,
// nonnull object + NSError** → NSErrorPointer parameter, sendNotification: → send(_:).
import Foundation
typealias NSErrorPointer = UnsafeMutablePointer<NSError?>?

protocol LibboxStringIteratorProtocol: NSObjectProtocol {
    func hasNext() -> Bool
    func len() -> Int32
    func next() -> String
}
class LibboxRoutePrefix: NSObject {
    func address() -> String { "" }
    func mask() -> String { "" }
    func prefix() -> Int32 { 0 }
    func string() -> String { "" }
}
protocol LibboxRoutePrefixIteratorProtocol: NSObjectProtocol {
    func hasNext() -> Bool
    func next() -> LibboxRoutePrefix?
}
class LibboxStringBox: NSObject { var value: String = "" }
let LibboxDNSModeDisabled: String = "disabled"
let LibboxInterfaceTypeCellular: Int32 = 1
let LibboxInterfaceTypeEthernet: Int32 = 2
let LibboxInterfaceTypeOther: Int32 = 3
let LibboxInterfaceTypeWIFI: Int32 = 0
let LibboxCommandStatus: Int32 = 1

protocol LibboxTunOptionsProtocol: NSObjectProtocol {
    func getAutoRoute() -> Bool
    func getDNSMode() -> LibboxStringBox?
    func getDNSServerAddress() throws -> any LibboxStringIteratorProtocol
    func getExcludePackage() -> (any LibboxStringIteratorProtocol)?
    func getHTTPProxyBypassDomain() -> (any LibboxStringIteratorProtocol)?
    func getHTTPProxyMatchDomain() -> (any LibboxStringIteratorProtocol)?
    func getHTTPProxyServer() -> String
    func getHTTPProxyServerPort() -> Int32
    func getIncludePackage() -> (any LibboxStringIteratorProtocol)?
    func getInet4Address() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet4RouteAddress() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet4RouteExcludeAddress() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet4RouteRange() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet6Address() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet6RouteAddress() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet6RouteExcludeAddress() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getInet6RouteRange() -> (any LibboxRoutePrefixIteratorProtocol)?
    func getMTU() -> Int32
    func getStrictRoute() -> Bool
    func isHTTPProxyEnabled() -> Bool
}

protocol LibboxInterfaceUpdateListenerProtocol: NSObjectProtocol {
    func updateDefaultInterface(_ interfaceName: String?, interfaceIndex: Int32, isExpensive: Bool, isConstrained: Bool)
    func updateNetworkPath(_ networkPath: String?)
}
protocol LibboxNeighborUpdateListenerProtocol: NSObjectProtocol {}
protocol LibboxLocalDNSTransportProtocol: NSObjectProtocol {}
protocol LibboxBridgeSessionProtocol: NSObjectProtocol {}
protocol LibboxAutoRedirectHandlerProtocol: NSObjectProtocol {}
protocol LibboxAutoRedirectSessionProtocol: NSObjectProtocol {}
protocol LibboxShellSessionProtocol: NSObjectProtocol {}
class LibboxNetworkInterface: NSObject {
    var index: Int32 = 0
    var mtu: Int32 = 0
    var name: String = ""
    var type: Int32 = 0
    var metered: Bool = false
}
protocol LibboxNetworkInterfaceIteratorProtocol: NSObjectProtocol {
    func hasNext() -> Bool
    func next() -> LibboxNetworkInterface?
}
class LibboxConnectionOwner: NSObject {}
class LibboxWIFIState: NSObject {}
class LibboxNotification: NSObject {}
class LibboxPlatformUser: NSObject {}
class LibboxBridgeOptions: NSObject {}
class LibboxSystemProxyStatus: NSObject {
    var available = false
    var enabled = false
}

protocol LibboxPlatformInterfaceProtocol: NSObjectProtocol {
    func autoDetectControl(_ fd: Int32) throws
    func cancelNotification(_ identifier: String?, typeID: Int32) throws
    func checkPlatformShell() throws
    func clearDNSCache()
    func closeDefaultInterfaceMonitor(_ listener: (any LibboxInterfaceUpdateListenerProtocol)?) throws
    func closeNeighborMonitor(_ listener: (any LibboxNeighborUpdateListenerProtocol)?) throws
    func createAutoRedirect(_ options: Data?, handler: (any LibboxAutoRedirectHandlerProtocol)?) throws -> any LibboxAutoRedirectSessionProtocol
    func createBridge(_ options: LibboxBridgeOptions?) throws -> any LibboxBridgeSessionProtocol
    func findConnectionOwner(_ ipProtocol: Int32, sourceAddress: String?, sourcePort: Int32, destinationAddress: String?, destinationPort: Int32) throws -> LibboxConnectionOwner
    func getInterfaces() throws -> any LibboxNetworkInterfaceIteratorProtocol
    func includeAllNetworks() -> Bool
    func localDNSTransport() -> (any LibboxLocalDNSTransportProtocol)?
    func lookupSFTPServer(_ error: NSErrorPointer) -> String
    func lookupUser(_ username: String?) throws -> LibboxPlatformUser
    func openShellSession(_ user: LibboxPlatformUser?, command: String?, environ: (any LibboxStringIteratorProtocol)?, term: String?, rows: Int32, cols: Int32) throws -> any LibboxShellSessionProtocol
    func openTun(_ options: (any LibboxTunOptionsProtocol)?, ret0_: UnsafeMutablePointer<Int32>?) throws
    func readSystemSSHHostKey(_ error: NSErrorPointer) -> String
    func readWIFIState() -> LibboxWIFIState?
    func registerMyInterface(_ name: String?)
    func send(_ notification: LibboxNotification?) throws
    func startDefaultInterfaceMonitor(_ listener: (any LibboxInterfaceUpdateListenerProtocol)?) throws
    func startNeighborMonitor(_ listener: (any LibboxNeighborUpdateListenerProtocol)?) throws
    func tailscaleHostname() -> String
    func underNetworkExtension() -> Bool
    func usePlatformAutoDetectControl() -> Bool
    func usePlatformAutoRedirect() -> Bool
    func usePlatformBridge() -> Bool
    func usePlatformShell() -> Bool
    func useProcFS() -> Bool
}

protocol LibboxCommandServerHandlerProtocol: NSObjectProtocol {
    func connectSSHAgent(_ ret0_: UnsafeMutablePointer<Int32>?) throws
    func getSystemProxyStatus() throws -> LibboxSystemProxyStatus
    func serviceReload() throws
    func serviceStop() throws
    func setSystemProxyEnabled(_ enabled: Bool) throws
    func triggerNativeCrash() throws
    func writeDebugMessage(_ message: String?)
}

class LibboxOverrideOptions: NSObject {}
class LibboxCommandServer: NSObject {
    func close() {}
    func closeService() throws {}
    func pause() {}
    func wake() {}
    func wakeNow() {}
    func recordScreenState(_ on: Bool) {}
    func start() throws {}
    func startOrReloadService(_ configContent: String?, options: LibboxOverrideOptions?) throws {}
}
class LibboxSetupOptions: NSObject {
    var basePath = "", workingPath = "", tempPath = ""
    var logMaxLines = 0
    var debug = false
    var crashReportSource = "", appVersion = "", appMarketingVersion = ""
    var oomKillerEnabled = false
    var platformMetadata = ""
}
func LibboxSetup(_ options: LibboxSetupOptions?, _ error: NSErrorPointer) {}
func LibboxNewCommandServer(_ handler: (any LibboxCommandServerHandlerProtocol)?, _ platformInterface: (any LibboxPlatformInterfaceProtocol)?, _ error: NSErrorPointer) -> LibboxCommandServer? { nil }
func LibboxGetTunnelFileDescriptor() -> Int32 { -1 }
func LibboxVersion() -> String { "" }
func LibboxPrepareCrashSignalHandlers() {}
func LibboxReinstallCrashSignalHandlers() {}
func LibboxNewStandaloneCommandClient() -> LibboxCommandClient? { nil }

class LibboxStatusMessage: NSObject {
    var memory: Int64 = 0
    var trafficAvailable = false
    var uplink: Int64 = 0, downlink: Int64 = 0, uplinkTotal: Int64 = 0, downlinkTotal: Int64 = 0
}
protocol LibboxOutboundGroupIteratorProtocol: NSObjectProtocol {}
protocol LibboxLogIteratorProtocol: NSObjectProtocol {}
protocol LibboxOutboundGroupItemIteratorProtocol: NSObjectProtocol {}
class LibboxConnectionEvents: NSObject {}
protocol LibboxCommandClientHandlerProtocol: NSObjectProtocol {
    func clearLogs()
    func connected()
    func disconnected(_ message: String?)
    func initializeClashMode(_ modeList: (any LibboxStringIteratorProtocol)?, currentMode: String?)
    func setDefaultLogLevel(_ level: Int32)
    func updateClashMode(_ newMode: String?)
    func write(_ events: LibboxConnectionEvents?)
    func writeGroups(_ message: (any LibboxOutboundGroupIteratorProtocol)?)
    func writeLogs(_ messageList: (any LibboxLogIteratorProtocol)?)
    func writeOutbounds(_ message: (any LibboxOutboundGroupItemIteratorProtocol)?)
    func writeStatus(_ message: LibboxStatusMessage?)
}
class LibboxCommandClientOptions: NSObject {
    var statusInterval: Int64 = 0
    func addCommand(_ command: Int32) {}
}
class LibboxCommandClient: NSObject {
    func connect() throws {}
    func disconnect() throws {}
    func serviceClose() throws {}
}
func LibboxNewCommandClient(_ handler: (any LibboxCommandClientHandlerProtocol)?, _ options: LibboxCommandClientOptions?) -> LibboxCommandClient? { nil }
