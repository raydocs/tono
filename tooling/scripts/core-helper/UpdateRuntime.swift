import Foundation
import Darwin
import SystemConfiguration

/// Native observations only. The App may restore its legacy proxy snapshot,
/// but an App Boolean never attests DNS, the TUN, Core or PF for an update.
final class UpdateRuntime {
    let core: CoreManager
    let firewall: KillSwitchManager
    let dns: ProtectedDNSManager
    let power: PowerTransitionGate

    init(core: CoreManager, firewall: KillSwitchManager, dns: ProtectedDNSManager, power: PowerTransitionGate) {
        self.core = core
        self.firewall = firewall
        self.dns = dns
        self.power = power
    }

    func observe() throws -> UpdateContractV1.Protection {
        let pf = firewall.status()
        let resolver = dns.status()
        guard power.isAwake(), pf["ok"] as? Bool == true, resolver["ok"] as? Bool == true,
              let live = pf["live"] as? Bool, let wanted = pf["wantArmed"] as? Bool,
              let armed = pf["armed"] as? Bool else { return .unknown }
        let running = core.status().running
        if live && wanted && armed {
            if running && resolver["configured"] as? Bool == true { return .connected }
            if !running && resolver["snapshotPresent"] as? Bool == false && if_nametoindex("utun199") == 0 {
                try dns.verifyRestored()
                try verifyProxyRestored()
                return .protectedOffline
            }
        } else if !live && !wanted && !armed && !running && resolver["snapshotPresent"] as? Bool == false
                    && if_nametoindex("utun199") == 0 {
            try dns.verifyRestored()
            try verifyProxyRestored()
            return .unprotected
        }
        return .unknown
    }

    func prepare(_ obligation: UpdateContractV1.Protection) throws -> UpdateContractV1.Protection {
        if obligation == .connected || obligation == .protectedOffline { try retainBootstrap() }
        try core.stop()
        guard !core.status().running else { throw HelperFailure.invalid("Update Core stop was not observed.") }
        for _ in 0..<50 where if_nametoindex("utun199") != 0 { usleep(100_000) }
        guard if_nametoindex("utun199") == 0 else { throw HelperFailure.invalid("Update TUN stop was not observed.") }
        // Includes per-service readback; failure retains snapshot. No app reply
        // carries this restore, so a lost original is recorded for the next one.
        _ = try dns.restore(deferringLossNotice: true)
        try verifyProxyRestored()
        // configd's active store converges asynchronously after commit/apply.
        for _ in 0..<30 {
            if (try? dns.verifyRestored()) != nil { break }
            usleep(100_000)
        }
        return try observe()
    }

    func retainBootstrap() throws {
        guard let previous = try firewall.loadState(), previous.armed else {
            throw HelperFailure.invalid("Cannot recover unknown update protection.")
        }
        _ = try firewall.arm([
            "apiHosts": previous.apiHosts,
            "exitHints": [], "tunnelInterfaces": [], "proxyEndpoints": [],
            "sessionDirectEndpoints": [], "tailscaleBootstrapEnabled": false,
            "allowSystemResolution": false, "reviewedBundleDirect": false,
            "bootstrapPins": previous.pinnedHosts.filter { previous.apiHosts.contains($0.key) },
        ], commitAllowed: { self.power.isAwake() })
    }

    func disconnect() throws {
        let pf = firewall.status()
        _ = try prepare(pf["wantArmed"] as? Bool == true ? .protectedOffline : .unprotected)
        _ = try power.whileAwake { try firewall.disarm() }
        guard try observe() == .unprotected else { throw HelperFailure.invalid("Update Disconnect was not observed.") }
    }

    func verifyRecovery(requiresTUN: Bool) throws -> UpdateContractV1.Protection {
        let protection = try observe()
        if protection == .connected {
            guard !requiresTUN || if_nametoindex("utun199") != 0 else {
                throw HelperFailure.invalid("Successor TUN is not present.")
            }
            // Probe through the actual owned runtime's selected exit, not an
            // App claim or an unauthenticated localhost listener. The root
            // config secret never appears in command arguments or diagnostics.
            let bytes = try UpdateStorage.read(runtimeConfigPath, maximum: 8 * 1024 * 1024)
            guard let config = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
                  let experimental = config["experimental"] as? [String: Any],
                  let controller = experimental["clash_api"] as? [String: Any],
                  let address = controller["external_controller"] as? String, address.hasPrefix("127.0.0.1:"),
                  let secret = controller["secret"] as? String,
                  let url = URL(string: "http://\(address)/proxies/Tono-Exit/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=5000") else {
                throw HelperFailure.invalid("Cannot inspect successor runtime configuration.")
            }
            var request = URLRequest(url: url, timeoutInterval: 7)
            request.setValue("Bearer \(secret)", forHTTPHeaderField: "Authorization")
            let result = UpdateProbeResult()
            let session = URLSession(configuration: .ephemeral)
            defer { session.invalidateAndCancel() }
            let task = session.dataTask(with: request) { data, response, error in
                result.finish(data: data, response: response, error: error)
            }
            task.resume()
            guard result.wait() else { throw HelperFailure.invalid("Successor exit traffic was not verified.") }
        }
        return protection
    }

    /// Read persisted AND active settings for every network service. No
    /// loopback HTTP/HTTPS/SOCKS proxy may remain pointed at the stopped Core.
    func verifyProxyRestored() throws {
        guard let prefs = SCPreferencesCreate(nil, "Tono update proxy readback" as CFString, nil),
              let services = SCNetworkServiceCopyAll(prefs) as? [SCNetworkService],
              let store = SCDynamicStoreCreate(nil, "Tono update proxy readback" as CFString, nil, nil) else {
            throw HelperFailure.invalid("Cannot read system proxy state for update.")
        }
        for service in services {
            guard let serviceID = SCNetworkServiceGetServiceID(service),
                  let proto = SCNetworkServiceCopyProtocol(service, kSCNetworkProtocolTypeProxies),
                  let config = SCNetworkProtocolGetConfiguration(proto) as? [String: Any] else {
                throw HelperFailure.invalid("Cannot read a network service proxy configuration.")
            }
            try Self.noCoreProxy(config)
            let key = "State:/Network/Service/\(serviceID as String)/Proxies"
            if let live = SCDynamicStoreCopyValue(store, key as CFString) as? [String: Any] { try Self.noCoreProxy(live) }
        }
    }

    private static func noCoreProxy(_ config: [String: Any]) throws {
        for name in ["HTTP", "HTTPS", "SOCKS"] {
            if (config[name + "Enable"] as? NSNumber)?.boolValue == true,
               let host = config[name + "Proxy"] as? String,
               ["127.0.0.1", "localhost", "::1"].contains(host.lowercased()) {
                throw HelperFailure.invalid("A loopback system proxy remains active; restore it before updating.")
            }
        }
    }
}

private final class UpdateProbeResult: @unchecked Sendable {
    private let lock = NSLock()
    private let done = DispatchSemaphore(value: 0)
    private var verified = false

    func finish(data: Data?, response: URLResponse?, error: Error?) {
        lock.lock()
        if error == nil, (response as? HTTPURLResponse)?.statusCode == 200,
           let data, data.count < 4096,
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let delay = object["delay"] as? Int, delay >= 0 { verified = true }
        lock.unlock()
        done.signal()
    }

    func wait() -> Bool {
        guard done.wait(timeout: .now() + 8) == .success else { return false }
        lock.lock()
        defer { lock.unlock() }
        return verified
    }
}
