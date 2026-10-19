// Scratch stub of the NetworkExtension / Network / notify / os.log surface Tono uses (iOS 16 SDK names).
import Foundation

class NEIPv4Route: NSObject {
    init(destinationAddress: String, subnetMask: String) {}
    class func `default`() -> NEIPv4Route { NEIPv4Route(destinationAddress: "0.0.0.0", subnetMask: "0.0.0.0") }
}
class NEIPv6Route: NSObject {
    init(destinationAddress: String, networkPrefixLength: NSNumber?) {}
    class func `default`() -> NEIPv6Route { NEIPv6Route(destinationAddress: "::", networkPrefixLength: 0) }
}
class NEIPv4Settings: NSObject {
    init(addresses: [String], subnetMasks: [String]) {}
    var includedRoutes: [NEIPv4Route]?
    var excludedRoutes: [NEIPv4Route]?
}
class NEIPv6Settings: NSObject {
    init(addresses: [String], networkPrefixLengths: [NSNumber]) {}
    var includedRoutes: [NEIPv6Route]?
    var excludedRoutes: [NEIPv6Route]?
}
class NEDNSSettings: NSObject {
    init(servers: [String]) {}
    var matchDomains: [String]?
    var matchDomainsNoSearch = false
}
class NETunnelNetworkSettings: NSObject {
    init(tunnelRemoteAddress: String) {}
    var dnsSettings: NEDNSSettings?
}
class NEPacketTunnelNetworkSettings: NETunnelNetworkSettings {
    var ipv4Settings: NEIPv4Settings?
    var ipv6Settings: NEIPv6Settings?
    var mtu: NSNumber?
}
class NEPacketTunnelFlow: NSObject {
    func value(forKeyPath keyPath: String) -> Any? { nil }
}
class NEVPNProtocol: NSObject {
    var serverAddress: String?
    var includeAllNetworks = false
    var excludeLocalNetworks = false
    var enforceRoutes = false
    var disconnectOnSleep = false
    var excludeAPNs = true
    var excludeCellularServices = true
    var excludeDeviceCommunication = true
}
class NETunnelProviderProtocol: NEVPNProtocol {
    var providerBundleIdentifier: String?
    var providerConfiguration: [String: Any]?
}
enum NEProviderStopReason: Int {
    case none = 0, userInitiated, providerFailed, noNetworkAvailable, unrecoverableNetworkChange, providerDisabled,
         authenticationCanceled, configurationFailed, idleTimeout, configurationDisabled, configurationRemoved, superceded,
         userLogout, userSwitch, connectionFailed, sleep, appUpdate, internalError
}
class NEProvider: NSObject {
    func sleep() async {}
    func wake() {}
}
class NETunnelProvider: NEProvider {
    var protocolConfiguration: NEVPNProtocol { NEVPNProtocol() }
    var reasserting = false
    func handleAppMessage(_ messageData: Data) async -> Data? { nil }
    func setTunnelNetworkSettings(_ tunnelNetworkSettings: NETunnelNetworkSettings?) async throws {}
}
class NEPacketTunnelProvider: NETunnelProvider {
    var packetFlow: NEPacketTunnelFlow { NEPacketTunnelFlow() }
    func startTunnel(options: [String: NSObject]?) async throws {}
    func stopTunnel(with reason: NEProviderStopReason) async {}
    func cancelTunnelWithError(_ error: Error?) {}
}

// MARK: manager side
enum NEVPNStatus: Int, Sendable { case invalid = 0, disconnected, connecting, connected, reasserting, disconnecting }
class NEVPNConnection: NSObject {
    var status: NEVPNStatus { .invalid }
    var connectedDate: Date? { nil }
    func startVPNTunnel() throws {}
    func startVPNTunnel(options: [String: NSObject]?) throws {}
    func stopVPNTunnel() {}
    func fetchLastDisconnectError() async throws {}
}
class NETunnelProviderSession: NEVPNConnection {
    func sendProviderMessage(_ messageData: Data, responseHandler: ((Data?) -> Void)?) throws {}
}
class NEOnDemandRule: NSObject {
    var interfaceTypeMatch: NEOnDemandRuleInterfaceType = .any
    var probeURL: URL?
}
enum NEOnDemandRuleInterfaceType: Int { case any = 0, ethernet, wiFi, cellular }
class NEOnDemandRuleConnect: NEOnDemandRule {}
class NEVPNManager: NSObject {
    var connection: NEVPNConnection { NEVPNConnection() }
    var protocolConfiguration: NEVPNProtocol?
    var localizedDescription: String?
    var isEnabled = false
    var isOnDemandEnabled = false
    var onDemandRules: [NEOnDemandRule]?
    func saveToPreferences() async throws {}
    func loadFromPreferences() async throws {}
    func removeFromPreferences() async throws {}
}
class NETunnelProviderManager: NEVPNManager {
    override init() {}
    class func loadAllFromPreferences() async throws -> [NETunnelProviderManager] { [] }
}
extension NSNotification.Name {
    static let NEVPNStatusDidChange = NSNotification.Name("NEVPNStatusDidChange")
    static let NEVPNConfigurationChange = NSNotification.Name("NEVPNConfigurationChange")
}
enum NEVPNError: Error {
    case configurationInvalid, configurationDisabled, connectionFailed, configurationStale, configurationReadWriteFailed, configurationUnknown
    enum Code: Int { case configurationInvalid = 1, configurationDisabled, connectionFailed, configurationStale, configurationReadWriteFailed, configurationUnknown }
}
let NEVPNErrorDomain = "NEVPNErrorDomain"

// MARK: Network
struct NWInterface {
    enum InterfaceType { case other, wifi, cellular, wiredEthernet, loopback }
    var name: String
    var index: Int
    var type: InterfaceType
}
enum Network { typealias NWPath = NWPathImpl }
typealias NWPath = NWPathImpl
struct NWPathImpl {
    enum Status { case satisfied, unsatisfied, requiresConnection }
    var status: Status
    var availableInterfaces: [NWInterface]
    var supportsIPv4: Bool
    var supportsIPv6: Bool
    var supportsDNS: Bool
    var isExpensive: Bool
    var isConstrained: Bool
}
final class NWPathMonitor {
    init() {}
    init(prohibitedInterfaceTypes: [NWInterface.InterfaceType]) {}
    var pathUpdateHandler: ((NWPath) -> Void)?
    var currentPath: NWPath { fatalError() }
    func start(queue: DispatchQueue) {}
    func cancel() {}
}
enum NWEndpoint {
    struct Host { init(_ s: String) {} }
    struct Port { init?(rawValue: UInt16) {} }
}
class NWProtocolTLS {
    class Options { var securityProtocolOptions: sec_protocol_options_t { sec_protocol_options_t() } }
}
class sec_protocol_options_t {}
func sec_protocol_options_set_tls_server_name(_ o: sec_protocol_options_t, _ name: String) {}
class NWProtocolTCP { class Options { var connectionTimeout = 0 } }
final class NWParameters {
    static var tcp: NWParameters { NWParameters() }
    init() {}
    init(tls: NWProtocolTLS.Options?, tcp: NWProtocolTCP.Options = .init()) {}
}
final class NWConnection {
    enum State { case setup, waiting(NWError), preparing, ready, failed(NWError), cancelled }
    struct ContentContext { static let defaultMessage = ContentContext() }
    enum SendCompletion { case contentProcessed((NWError?) -> Void) }
    init(host: NWEndpoint.Host, port: NWEndpoint.Port, using: NWParameters) {}
    var stateUpdateHandler: ((State) -> Void)?
    func start(queue: DispatchQueue) {}
    func cancel() {}
    func send(content: Data?, contentContext: ContentContext = .defaultMessage, isComplete: Bool = true, completion: SendCompletion) {}
    func receive(minimumIncompleteLength: Int, maximumLength: Int, completion: @escaping (Data?, ContentContext?, Bool, NWError?) -> Void) {}
}
enum NWError: Error { case posix(Int32), dns(Int32), tls(Int32) }

// MARK: notify / os.log
func notify_register_dispatch(_ name: String, _ token: UnsafeMutablePointer<Int32>, _ queue: DispatchQueue, _ handler: @escaping (Int32) -> Void) -> UInt32 { 0 }
func notify_get_state(_ token: Int32, _ state: UnsafeMutablePointer<UInt64>) -> UInt32 { 0 }
func notify_cancel(_ token: Int32) -> UInt32 { 0 }

struct OSLogPrivacy { static let `public` = OSLogPrivacy(); static let `private` = OSLogPrivacy() }
struct OSLogMessage: ExpressibleByStringInterpolation, ExpressibleByStringLiteral {
    struct Interpolation: StringInterpolationProtocol {
        init(literalCapacity: Int, interpolationCount: Int) {}
        mutating func appendLiteral(_ s: String) {}
        mutating func appendInterpolation<T>(_ v: T, privacy: OSLogPrivacy = .private) {}
    }
    init(stringInterpolation: Interpolation) {}
    init(stringLiteral: String) {}
}
struct Logger {
    init(subsystem: String, category: String) {}
    func info(_ m: OSLogMessage) {}
    func error(_ m: OSLogMessage) {}
    func debug(_ m: OSLogMessage) {}
    func warning(_ m: OSLogMessage) {}
}
extension FileManager {
    func containerURL(forSecurityApplicationGroupIdentifier id: String) -> URL? { nil }
}
extension URLFileProtection { static let completeUntilFirstUserAuthentication = URLFileProtection(rawValue: "x") }
struct URLFileProtection: RawRepresentable, Hashable { var rawValue: String }
