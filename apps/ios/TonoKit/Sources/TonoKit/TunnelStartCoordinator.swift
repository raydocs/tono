import Foundation

/// The configuration steps one tunnel switch is made of, on Tono's one VPN configuration. The app's
/// Network Extension manager performs them; tests pause them where the system would.
@MainActor
public protocol TunnelLifecycleSteps: AnyObject {
    /// Reads Tono's configuration from the system again, finding it when not known yet; true when saved.
    func refresh() async -> Bool
    /// Writes and saves what a start needs, On Demand armed. The first save shows the iOS prompt.
    func saveForStart() async throws
    /// Re-reads the saved configuration (Apple: after a save, before the start).
    func reloadForStart() async throws
    /// Asks the system to start the tunnel; the status reports the rest.
    func startTunnel() throws
    /// On Demand as last saved or read.
    var onDemandEnabled: Bool { get }
    /// Saves the configuration with On Demand off.
    func disarmOnDemand() async
    /// Lets sing-box close its connections, then stops the tunnel.
    func stopTunnel() async
    /// Takes the configuration (and its On Demand rule) off the phone.
    func removeConfiguration() async
}

/// One lifecycle for every path in the app's process that switches the tunnel. The latest switch
/// wins: each start, stop and removal takes over at its entry, before it waits for its turn, and a
/// start checks that it is still the latest after every system wait and just before it starts. The
/// steps run one switch at a time, so a start still saving can neither start after a Cancel nor
/// leave On Demand armed behind it, and a stale clean-up never disarms a newer start.
@MainActor
public final class TunnelStartCoordinator {
    public enum StartOutcome: Equatable, Sendable {
        case started
        /// A later switch (a Cancel, a sign-out, an outside command, another start) took over first:
        /// nothing started, and this is no failure of the switch the user made last.
        case superseded
    }

    /// Advanced at the entry of every start, stop and removal.
    public private(set) var generation: UInt64 = 0
    /// Statistics-only intent receipt. Zero inherits an existing NE session on initial load/process
    /// restart; a start exposes its generation, while stop/remove/cancel expose nil, never a start.
    /// On Demand does not issue another switch: it keeps the last start's epoch. This is read-only
    /// observation, not permission to start/stop the tunnel or evidence of protection.
    public var statisticsStartEpoch: UInt64? {
        generation == 0 || latestIsStart ? generation : nil
    }

    /// Switches and serialized operations waiting for their turn (the running one not counted).
    public var waiting: Int { queue.count }

    private var latestIsStart = false
    private var pendingStarts = 0
    private var busy = false
    private var queue: [CheckedContinuation<Void, Never>] = []

    public init() {}

    /// Starts unless a later switch takes over first. Throws only while this start is still the latest,
    /// after taking On Demand off again if its save had armed it.
    @discardableResult
    public func start(_ steps: TunnelLifecycleSteps) async throws -> StartOutcome {
        let mine = intend(start: true)
        pendingStarts += 1
        defer { pendingStarts -= 1 }
        await acquire()
        defer { release() }
        var armed = false
        do {
            guard mine == generation else { return .superseded }
            _ = await steps.refresh()
            guard mine == generation else { return .superseded }
            try await steps.saveForStart()
            armed = true
            guard mine == generation else { return await abandon(steps) }
            try await steps.reloadForStart()
            guard mine == generation else { return await abandon(steps) }
            try steps.startTunnel()
            return .started
        } catch {
            if mine != generation {
                if armed { return await abandon(steps) }
                return .superseded
            }
            if armed { await steps.disarmOnDemand() }
            guard mine == generation else { return .superseded }
            throw error
        }
    }

    /// Disowns a start synchronously before an account actor wait. The caller must still stop or
    /// remove the configuration afterwards; this alone does not stop a tunnel already running.
    public func cancelPendingStart() {
        intend(start: false)
    }

    /// Explicit disconnect: On Demand off first (or iOS restarts the tunnel at once), then the tunnel
    /// stops. Takes over at entry; in its turn it acts on the configuration as saved by then, so a
    /// first save that finished after the Cancel is found and disarmed too.
    public func stop(_ steps: TunnelLifecycleSteps) async {
        intend(start: false)
        await acquire()
        defer { release() }
        guard await steps.refresh() else { return }
        if steps.onDemandEnabled { await steps.disarmOnDemand() }
        await steps.stopTunnel()
    }

    /// Sign-out: takes over at entry, then removes the configuration as saved by its turn.
    public func remove(_ steps: TunnelLifecycleSteps) async {
        intend(start: false)
        await acquire()
        defer { release() }
        guard await steps.refresh() else { return }
        await steps.removeConfiguration()
    }

    /// A start that already reached the system failed: On Demand off, so it does not loop on it. A start
    /// on its way, or any switch made since, owns On Demand instead, and this does nothing.
    public func disarmAfterFailedStart(_ steps: TunnelLifecycleSteps) async {
        guard pendingStarts == 0 else { return }
        let seen = generation
        await acquire()
        defer { release() }
        guard seen == generation, await steps.refresh(), seen == generation, steps.onDemandEnabled else { return }
        await steps.disarmOnDemand()
    }

    /// Runs `body` in turn with the switches without taking over from any (a settings save, a read of
    /// the configuration). `body` must not call back into this coordinator: it would wait on itself.
    public func exclusive<T>(_ body: () async throws -> T) async rethrows -> T {
        await acquire()
        defer { release() }
        return try await body()
    }

    /// A superseded start whose save armed On Demand: a stop or removal that took over would find it,
    /// but disarming here leaves nothing to chance. A newer start arms it again in its own save.
    private func abandon(_ steps: TunnelLifecycleSteps) async -> StartOutcome {
        if !latestIsStart { await steps.disarmOnDemand() }
        return .superseded
    }

    @discardableResult
    private func intend(start: Bool) -> UInt64 {
        generation &+= 1
        latestIsStart = start
        return generation
    }

    private func acquire() async {
        guard busy else { busy = true; return }
        await withCheckedContinuation { queue.append($0) }
    }

    /// Hands the turn to the next waiter in arrival order, or frees it.
    private func release() {
        if queue.isEmpty { busy = false } else { queue.removeFirst().resume() }
    }
}
