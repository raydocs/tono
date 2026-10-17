import Foundation
import Libbox
import Network
import NetworkExtension
import os.log

/// libbox's view of iOS: turns sing-box's TUN request into NEPacketTunnelNetworkSettings, hands
/// back the utun descriptor, and reports the underlying network. Method set and Swift names follow
/// the gobind header of libbox at sing-box 25b0d5ea (v1.15.0-alpha.12) as Swift imports it (e.g.
/// `autoDetectInterfaceControl:` becomes `autoDetectControl(_:)`); features Tono does not use
/// (shell, bridge, auto-redirect, notifications, Wi-Fi state) refuse explicitly.
final class TunnelPlatform: NSObject, LibboxPlatformInterfaceProtocol, LibboxCommandServerHandlerProtocol {
    private unowned let provider: PacketTunnelProvider
    private var settings: NEPacketTunnelNetworkSettings?
    private var monitor: NWPathMonitor?
    private var lastPath: String?

    init(provider: PacketTunnelProvider) {
        self.provider = provider
    }

    func reset() {
        settings = nil
        monitor?.cancel()
        monitor = nil
        lastPath = nil
    }

    // MARK: TUN

    func openTun(_ options: (any LibboxTunOptionsProtocol)?, ret0_: UnsafeMutablePointer<Int32>?) throws {
        guard let options, let ret0_ else { throw TunnelPlatform.error("missing TUN options") }
        let settings = try Self.networkSettings(options)
        try runBlocking { [provider] in try await provider.setTunnelNetworkSettings(settings) }
        self.settings = settings
        // Same descriptor lookup as the upstream Apple client: the packet flow's socket, else a utun scan.
        if let fd = provider.packetFlow.value(forKeyPath: "socket.fileDescriptor") as? Int32 {
            ret0_.pointee = fd
            return
        }
        let fd = LibboxGetTunnelFileDescriptor()
        guard fd != -1 else { throw TunnelPlatform.error("utun file descriptor not found") }
        ret0_.pointee = fd
    }

    /// sing-box `auto_route` → system routes: everything into the tunnel except the excluded
    /// LAN/link-local/multicast ranges, IPv4 and IPv6 alike, DNS to the TUN's own resolver.
    static func networkSettings(_ options: any LibboxTunOptionsProtocol) throws -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        guard options.getAutoRoute() else { throw error("Tono requires auto_route") }
        settings.mtu = NSNumber(value: options.getMTU())

        var v4Addresses: [String] = [], v4Masks: [String] = []
        prefixes(options.getInet4Address()).forEach { v4Addresses.append($0.address()); v4Masks.append($0.mask()) }
        let v4 = NEIPv4Settings(addresses: v4Addresses, subnetMasks: v4Masks)
        let v4Include = prefixes(options.getInet4RouteAddress()).map { NEIPv4Route(destinationAddress: $0.address(), subnetMask: $0.mask()) }
        v4.includedRoutes = v4Include.isEmpty ? [NEIPv4Route.default()] : v4Include
        v4.excludedRoutes = prefixes(options.getInet4RouteExcludeAddress()).map { NEIPv4Route(destinationAddress: $0.address(), subnetMask: $0.mask()) }
        settings.ipv4Settings = v4

        var v6Addresses: [String] = [], v6Prefixes: [NSNumber] = []
        prefixes(options.getInet6Address()).forEach { v6Addresses.append($0.address()); v6Prefixes.append(NSNumber(value: $0.prefix())) }
        if !v6Addresses.isEmpty {
            let v6 = NEIPv6Settings(addresses: v6Addresses, networkPrefixLengths: v6Prefixes)
            let v6Include = prefixes(options.getInet6RouteAddress()).map {
                NEIPv6Route(destinationAddress: $0.address(), networkPrefixLength: NSNumber(value: $0.prefix()))
            }
            v6.includedRoutes = v6Include.isEmpty ? [NEIPv6Route.default()] : v6Include
            v6.excludedRoutes = prefixes(options.getInet6RouteExcludeAddress()).map {
                NEIPv6Route(destinationAddress: $0.address(), networkPrefixLength: NSNumber(value: $0.prefix()))
            }
            settings.ipv6Settings = v6
        }

        if options.getDNSMode()?.value != LibboxDNSModeDisabled {
            let servers = strings(try options.getDNSServerAddress())
            if !servers.isEmpty {
                let dns = NEDNSSettings(servers: servers)
                // Every name, including single-label and search-domain names, asks the tunnel first.
                dns.matchDomains = [""]
                dns.matchDomainsNoSearch = true
                settings.dnsSettings = dns
            }
        }
        return settings
    }

    static func prefixes(_ iterator: (any LibboxRoutePrefixIteratorProtocol)?) -> [LibboxRoutePrefix] {
        var out: [LibboxRoutePrefix] = []
        while let iterator, iterator.hasNext() {
            if let p = iterator.next() { out.append(p) }
        }
        return out
    }

    static func strings(_ iterator: (any LibboxStringIteratorProtocol)?) -> [String] {
        var out: [String] = []
        while let iterator, iterator.hasNext() { out.append(iterator.next()) }
        return out
    }

    // MARK: Underlying network

    func usePlatformAutoDetectControl() -> Bool { false }

    func autoDetectControl(_ fd: Int32) throws {}

    func startDefaultInterfaceMonitor(_ listener: (any LibboxInterfaceUpdateListenerProtocol)?) throws {
        guard let listener else { return }
        let monitor = NWPathMonitor()
        self.monitor = monitor
        let first = DispatchSemaphore(value: 0)
        let once = Once()
        monitor.pathUpdateHandler = { [weak self] path in
            self?.publish(path, to: listener)
            once.run { first.signal() }
        }
        monitor.start(queue: DispatchQueue(label: "tono.tunnel.path"))
        _ = first.wait(timeout: .now() + 5)
    }

    private func publish(_ path: Network.NWPath, to listener: any LibboxInterfaceUpdateListenerProtocol) {
        let description = UnderlyingNetwork.describe(path)
        listener.updateNetworkPath(description)
        guard description != lastPath else { return }
        lastPath = description
        guard path.status != .unsatisfied, let interface = path.availableInterfaces.first else {
            listener.updateDefaultInterface("", interfaceIndex: -1, isExpensive: false, isConstrained: false)
            return
        }
        listener.updateDefaultInterface(interface.name, interfaceIndex: Int32(interface.index),
                                        isExpensive: path.isExpensive, isConstrained: path.isConstrained)
    }

    func closeDefaultInterfaceMonitor(_ listener: (any LibboxInterfaceUpdateListenerProtocol)?) throws {
        monitor?.cancel()
        monitor = nil
        lastPath = nil
    }

    func getInterfaces() throws -> any LibboxNetworkInterfaceIteratorProtocol {
        guard let path = monitor?.currentPath, path.status != .unsatisfied else { return InterfaceList([]) }
        return InterfaceList(path.availableInterfaces.map { item in
            let interface = LibboxNetworkInterface()
            interface.name = item.name
            interface.index = Int32(item.index)
            switch item.type {
            case .wifi: interface.type = LibboxInterfaceTypeWIFI
            case .cellular: interface.type = LibboxInterfaceTypeCellular
            case .wiredEthernet: interface.type = LibboxInterfaceTypeEthernet
            default: interface.type = LibboxInterfaceTypeOther
            }
            return interface
        })
    }

    final class InterfaceList: NSObject, LibboxNetworkInterfaceIteratorProtocol {
        private var items: [LibboxNetworkInterface]
        init(_ items: [LibboxNetworkInterface]) { self.items = items }
        func hasNext() -> Bool { !items.isEmpty }
        func next() -> LibboxNetworkInterface? { items.isEmpty ? nil : items.removeFirst() }
    }

    func underNetworkExtension() -> Bool { true }

    /// Mirrors the profile flag; sing-box then avoids stacks that cannot run under includeAllNetworks.
    func includeAllNetworks() -> Bool { provider.protocolConfiguration.includeAllNetworks }

    func localDNSTransport() -> (any LibboxLocalDNSTransportProtocol)? { nil }

    func clearDNSCache() {
        guard let settings else { return }
        // Re-applying the settings flushes the system resolver cache (upstream Apple client behaviour).
        runBlocking { [provider] in
            provider.reasserting = true
            defer { provider.reasserting = false }
            try? await provider.setTunnelNetworkSettings(nil)
            try? await provider.setTunnelNetworkSettings(settings)
        }
    }

    func useProcFS() -> Bool { false }

    func findConnectionOwner(_ ipProtocol: Int32, sourceAddress: String?, sourcePort: Int32, destinationAddress: String?,
                             destinationPort: Int32) throws -> LibboxConnectionOwner {
        // iOS exposes no per-connection app identity; the graph has no process or package rules.
        throw TunnelPlatform.error("connection owner is not available on iOS")
    }

    func readWIFIState() -> LibboxWIFIState? { nil }

    func send(_ notification: LibboxNotification?) throws {}

    func cancelNotification(_ identifier: String?, typeID: Int32) throws {}

    func startNeighborMonitor(_ listener: (any LibboxNeighborUpdateListenerProtocol)?) throws {}

    func closeNeighborMonitor(_ listener: (any LibboxNeighborUpdateListenerProtocol)?) throws {}

    func registerMyInterface(_ name: String?) {}

    func usePlatformShell() -> Bool { false }

    func checkPlatformShell() throws { throw TunnelPlatform.error("shell is not supported") }

    func openShellSession(_ user: LibboxPlatformUser?, command: String?, environ: (any LibboxStringIteratorProtocol)?, term: String?,
                          rows: Int32, cols: Int32) throws -> any LibboxShellSessionProtocol {
        throw TunnelPlatform.error("shell is not supported")
    }

    func lookupUser(_ username: String?) throws -> LibboxPlatformUser { throw TunnelPlatform.error("users are not supported") }

    func lookupSFTPServer(_ error: NSErrorPointer) -> String {
        error?.pointee = TunnelPlatform.error("SFTP is not supported")
        return ""
    }

    func readSystemSSHHostKey(_ error: NSErrorPointer) -> String {
        error?.pointee = TunnelPlatform.error("SSH is not supported")
        return ""
    }

    func tailscaleHostname() -> String { "" }

    func usePlatformBridge() -> Bool { false }

    func createBridge(_ options: LibboxBridgeOptions?) throws -> any LibboxBridgeSessionProtocol {
        throw TunnelPlatform.error("bridge is not supported")
    }

    func usePlatformAutoRedirect() -> Bool { false }

    func createAutoRedirect(_ options: Data?, handler: (any LibboxAutoRedirectHandlerProtocol)?) throws -> any LibboxAutoRedirectSessionProtocol {
        throw TunnelPlatform.error("auto-redirect is not supported")
    }

    // MARK: Command server handler

    func serviceStop() throws {
        provider.coreStopped()
    }

    func serviceReload() throws {
        provider.reloadInPlace(reason: "core requested reload")
    }

    func getSystemProxyStatus() throws -> LibboxSystemProxyStatus { LibboxSystemProxyStatus() }

    func setSystemProxyEnabled(_ enabled: Bool) throws {}

    func triggerNativeCrash() throws {}

    func writeDebugMessage(_ message: String?) {
        #if DEBUG
        PacketTunnelProvider.log.debug("\(message ?? "", privacy: .public)")
        #endif
    }

    func connectSSHAgent(_ ret0_: UnsafeMutablePointer<Int32>?) throws { throw TunnelPlatform.error("SSH agent is not supported") }

    static func error(_ message: String) -> NSError {
        NSError(domain: "TonoTunnel", code: 0, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

/// Blocks the calling (Go) thread until an async NetworkExtension call finishes, as the upstream
/// Apple client does: libbox callbacks are synchronous, NetworkExtension APIs are not.
func runBlocking<T>(_ block: @escaping () async throws -> T) throws -> T {
    let semaphore = DispatchSemaphore(value: 0)
    let box = ResultBox<T>()
    Task.detached(priority: .userInitiated) {
        do { box.result = .success(try await block()) } catch { box.result = .failure(error) }
        semaphore.signal()
    }
    semaphore.wait()
    return try box.result!.get()
}

func runBlocking(_ block: @escaping () async -> Void) {
    let semaphore = DispatchSemaphore(value: 0)
    Task.detached(priority: .userInitiated) {
        await block()
        semaphore.signal()
    }
    semaphore.wait()
}

private final class ResultBox<T>: @unchecked Sendable {
    var result: Result<T, Error>?
}
