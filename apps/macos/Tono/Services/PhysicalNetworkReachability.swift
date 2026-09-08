import Network
import SystemConfiguration
import Foundation

/// The interface kinds that can carry this Mac's own traffic. A tunnel reports
/// `.other` and is deliberately absent: the locked TUN is up on exactly the
/// machines this has to answer for, so counting it would answer "is anything
/// reachable" with "yes, through the thing being diagnosed".
nonisolated enum PhysicalLinkKind: String, CaseIterable, Sendable {
    case wifi
    case wiredEthernet
    case cellular

    var interfaceType: NWInterface.InterfaceType {
        switch self {
        case .wifi:
            .wifi
        case .wiredEthernet:
            .wiredEthernet
        case .cellular:
            .cellular
        }
    }
}

/// Physical link availability, published by the app's network monitor and read
/// by the protected-connection classifier.
///
/// Deliberately not the primary-network-service lookup, which stays non-nil for
/// a configured-but-disconnected service and so answers "offline" with "online"
/// exactly when it matters. Deliberately not the physical TCP or bypass probes
/// either: those are leak detectors, and a correctly armed session is supposed
/// to fail them.
///
/// The answer is one-sided on purpose. Offline is reported only once every kind
/// has been observed and none of them can carry a path; an unobserved monitor,
/// or a Mac reaching the internet over an interface kind this does not
/// enumerate, reads as "not known to be offline" and leaves the classifier's
/// existing reasoning untouched.
nonisolated final class PhysicalNetworkReachability: @unchecked Sendable {
    static let shared = PhysicalNetworkReachability()

    private let lock = NSLock()
    private var satisfied: [PhysicalLinkKind: Bool] = [:]

    var isPhysicallyOffline: Bool {
        lock.lock()
        defer { lock.unlock() }
        guard satisfied.count == PhysicalLinkKind.allCases.count else { return false }
        return satisfied.values.allSatisfy { !$0 }
    }

    func record(_ kind: PhysicalLinkKind, satisfied isSatisfied: Bool) {
        lock.lock()
        satisfied[kind] = isSatisfied
        lock.unlock()
    }

    /// Discards every observation, so a stopped monitor's last verdict cannot
    /// be read as a live one. Back to "not known to be offline" until the
    /// monitors publish again.
    func forgetObservations() {
        lock.lock()
        satisfied.removeAll()
        lock.unlock()
    }
}

/// Watches committed default-route and resolver changes without spawning
/// `route`/`networksetup` on a timer. The callback is observation only: PF is
/// already the synchronous fail-closed boundary for every transition.
nonisolated final class SystemNetworkChangeMonitor: @unchecked Sendable {
    private let callback: @MainActor @Sendable () -> Void
    private let queue = DispatchQueue(label: "com.raydocs.tono.network-events")
    private var store: SCDynamicStore?
    private var pathMonitors: [NWPathMonitor] = []

    init(callback: @escaping @MainActor @Sendable () -> Void) {
        self.callback = callback
    }

    func start() {
        startPhysicalLinkMonitors()
        guard store == nil else { return }
        var context = SCDynamicStoreContext(
            version: 0,
            info: Unmanaged.passUnretained(self).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let storeCallback: SCDynamicStoreCallBack = { _, _, info in
            guard let info else { return }
            let monitor = Unmanaged<SystemNetworkChangeMonitor>
                .fromOpaque(info)
                .takeUnretainedValue()
            Task { @MainActor in monitor.callback() }
        }
        guard let dynamicStore = SCDynamicStoreCreate(
            nil,
            "com.raydocs.tono.network-events" as CFString,
            storeCallback,
            &context
        ) else { return }
        let keys = [
            SCDynamicStoreKeyCreateNetworkGlobalEntity(
                nil,
                kSCDynamicStoreDomainState,
                kSCEntNetIPv4
            ) as String,
            SCDynamicStoreKeyCreateNetworkGlobalEntity(
                nil,
                kSCDynamicStoreDomainState,
                kSCEntNetIPv6
            ) as String,
            SCDynamicStoreKeyCreateNetworkGlobalEntity(
                nil,
                kSCDynamicStoreDomainState,
                kSCEntNetDNS
            ) as String,
        ]
        guard SCDynamicStoreSetNotificationKeys(
            dynamicStore,
            keys as CFArray,
            nil
        ) else { return }
        store = dynamicStore
        SCDynamicStoreSetDispatchQueue(dynamicStore, queue)
    }

    /// One path monitor per physical interface kind. A kind-constrained path
    /// stays satisfied while the tunnel owns the default route, and goes
    /// unsatisfied when the link itself is gone — which is the distinction the
    /// classifier needs and the only one this can honestly make.
    ///
    /// These publish and never call `callback`: the dynamic store already owns
    /// the change notification, and `NWPathMonitor` delivers an update the
    /// moment it starts, which at launch is not a network change.
    private func startPhysicalLinkMonitors() {
        guard pathMonitors.isEmpty else { return }
        for kind in PhysicalLinkKind.allCases {
            let monitor = NWPathMonitor(requiredInterfaceType: kind.interfaceType)
            monitor.pathUpdateHandler = { path in
                PhysicalNetworkReachability.shared.record(
                    kind,
                    satisfied: path.status == .satisfied
                )
            }
            monitor.start(queue: queue)
            pathMonitors.append(monitor)
        }
    }

    func stop() {
        for monitor in pathMonitors { monitor.cancel() }
        pathMonitors.removeAll()
        PhysicalNetworkReachability.shared.forgetObservations()
        guard let store else { return }
        SCDynamicStoreSetDispatchQueue(store, nil)
        self.store = nil
    }

    deinit {
        stop()
    }
}
