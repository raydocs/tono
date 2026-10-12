import Foundation

/// Owns connect/disconnect/switch/reconnect task identity, attempt IDs, and
/// the protection generation. AppState remains the SwiftUI-observed facade and
/// writes UI fields; it must not keep a second independently writable copy of
/// these tasks.
@MainActor
final class ConnectionCoordinator {
    var connectTask: Task<Void, Never>?
    var connectWatchdogTask: Task<Void, Never>?
    var connectAttemptID: UUID?
    var protectionOperationGeneration: UInt64 = 0
    private(set) var disconnectSequence: Task<Void, Never>?
    private var disconnectRequestID = 0
    /// True while the serialized teardown queue's newest request is an
    /// explicit release (Restore internet), including while that teardown is
    /// still in flight — a release can hold the queue for up to 180 s on the
    /// administrator repair prompt. The sleep/wake paths read it so a sleep
    /// cannot rewrite the user's pending release into preserve teardowns and
    /// wake recovery (R1-F2). A release that ends with PF still armed (the
    /// helper's sleep gate refused its disarm, or any other failure) keeps
    /// the intent until the user connects again, so wake and network-change
    /// recovery cannot turn it into a reconnect (X1-2).
    private var disconnectQueueReleaseIntent = false
    enum ReleaseDisposition: Equatable { case preserve, automatic, ordinaryQuit, explicit }
    // Explicit release survives an overlapping Quit, including its initial
    // preserve teardown. Only a newly admitted Connect retires this choice.
    private var explicitReleaseDominatesQuit = false

    func resolvedReleaseDisposition(_ requested: ReleaseDisposition) -> ReleaseDisposition {
        requested == .ordinaryQuit && explicitReleaseDominatesQuit ? .explicit : requested
    }
    // A completed switch/reload keeps the protection generation but retires
    // any health proof started on the previous runtime.
    private(set) var routeOperationGeneration: UInt64 = 0
    var nodeSwitchTask: Task<Void, Never>? {
        didSet { routeOperationGeneration &+= 1 }
    }
    var protectedReconnectTask: Task<Void, Never>?
    var unarmedReconnectTask: Task<Void, Never>?
    /// Set while the unarmed loop is waiting or probing, with the generation
    /// it runs under. A finished loop leaves its task handle behind, so the
    /// handle cannot say that. `restarted` holds from a network-change
    /// restart until that loop's first probe.
    var unarmedReconnectOwner: (id: UUID, generation: UInt64, restarted: Bool)?
    var protectedReconnectID: UUID?
    var lastProtectedReconnectKick: Date?
    var coreMonitorTask: Task<Void, Never>?
    var networkEnvironmentTask: Task<Void, Never>?
    var wakeRecoveryTask: Task<Void, Never>?
    var sleepRestrictTask: Task<Void, Never>?
    var configReloadTask: Task<Void, Never>? {
        didSet { routeOperationGeneration &+= 1 }
    }
    var configReloadRequestID = 0

    private var deferredConnect: (id: UUID, task: Task<Void, Never>)?

    /// One overall UI deadline for an explicit release (decision 092,
    /// one-click hard gate). The drain of older work is capped
    /// (`explicitReleaseDrainCap`, decision 094), and each helper call is
    /// bounded, but their sum can pass this (the repair prompt alone is 180 s),
    /// and the helper may still be serving an earlier long call. Past this
    /// deadline the UI publishes "unknown, still finishing" while the release
    /// keeps running. It is a UI deadline, not a bound on the release.
    var explicitReleaseDeadline: Duration = .seconds(60)
    private var explicitReleaseDeadlineTask: Task<Void, Never>?
    private var settledDisconnectRequestID = 0
    /// Set once a deadline published "still finishing"; cleared when the
    /// newest queued request settles. While set, the teardown is still in
    /// flight even though the UI no longer shows "Disconnecting…".
    private(set) var releaseStillFinishing = false
    /// The same interim state for a pending native-update release
    /// (`/update/disconnect`), which runs outside the teardown queue. AppState
    /// sets it at that release's deadline and clears it when the task ends.
    var updateReleaseStillFinishing = false
    /// Decision 094: how long an explicit release waits for cancelled
    /// connect/switch/reload work and an earlier teardown before it runs
    /// anyway. The helper's user-release fence refuses whatever that stale
    /// work sends later, so it cannot block the network again.
    var explicitReleaseDrainCap: Duration = .seconds(10)
    /// The cap holds only against a helper that fences on the user's
    /// release; any other helper keeps the uncapped wait, because nothing
    /// there refuses the stale work's later arms (decision 094 (b)).
    var releaseFenceAvailable: () -> Bool = { HelperManager.daemonKnownFenceAware }
    /// R10-F1: the work each capped explicit release stopped waiting for (an
    /// older teardown, cancelled connect / switch / reload), followed by that
    /// release's late readback, keyed by the release's request ID. It still
    /// runs its own network effects, so no Connect is admitted, and no later
    /// teardown runs, until it has settled. The release itself does not wait.
    /// R11-F1: an entry only ever waits for strictly older requests and
    /// entries (snapshots taken when it is built), and each entry is removed
    /// only by its own end, so the waits form no cycle and none is lost.
    private var cappedStaleWork: [Int: Task<Void, Never>] = [:]

    var cappedStaleWorkSettling: Bool { !cappedStaleWork.isEmpty }

    /// Test seam: how a fenced explicit release waits for older work
    /// (`waitAtMost` with the cap). Returns false when it stopped at the cap.
    var waitForStaleWork: @MainActor (_ tasks: [Task<Void, Never>], _ cap: Duration, _ requestID: Int) async -> Bool = {
        tasks, cap, _ in await ConnectionCoordinator.waitAtMost(tasks, cap: cap)
    }

    /// A snapshot of the capped work registered by releases older than
    /// `request` (all of it when nil), oldest first.
    private func cappedStaleWorkSnapshot(olderThan request: Int?) -> [Task<Void, Never>] {
        cappedStaleWork
            .filter { entry in request.map { entry.key < $0 } ?? true }
            .sorted { $0.key < $1.key }
            .map(\.value)
    }

    /// Waits until no capped stale work is left that a release older than
    /// `request` capped (all of it when nil, as for a Connect). Newer capped
    /// work may itself be waiting for the caller, so it is never awaited.
    func settleCappedStaleWork(olderThan request: Int? = nil) async {
        while true {
            let pending = cappedStaleWorkSnapshot(olderThan: request)
            guard !pending.isEmpty else { return }
            for work in pending { await work.value }
        }
    }

    /// Whether the pending or in-flight teardown queue's newest request is an
    /// explicit release, or was one that could not release PF. Newest-wins,
    /// matching `disconnectRequestID`: a later teardown request replaces the
    /// intent, completion of the newest request retires it once the release
    /// is confirmed, and a new Connect retires an unconfirmed one.
    var disconnectQueueRequestsRelease: Bool {
        disconnectQueueReleaseIntent
    }

    /// All teardown requests share one queue. Drain cancelled connection work
    /// before executing privileged stop/DNS/PF operations; cancelling a Task
    /// does not mean an in-flight helper request has stopped mutating the host.
    func enqueueDisconnect(
        waitingFor pendingTasks: [Task<Void, Never>] = [],
        releaseIntent: Bool = false,
        releaseDisposition: ReleaseDisposition? = nil,
        afterLateDrain: (@MainActor (UInt64) async -> Void)? = nil,
        operation: @escaping @MainActor (Int) async -> Void
    ) {
        cancelDeferredConnect()
        disconnectRequestID &+= 1
        let requestID = disconnectRequestID
        let disposition = releaseDisposition ?? (releaseIntent ? .explicit : .preserve)
        if disposition == .explicit { explicitReleaseDominatesQuit = true }
        disconnectQueueReleaseIntent = releaseIntent
        let previousDisconnect = disconnectSequence
        disconnectSequence = Task {
            // Strictly older only: the previous request and capped work that
            // releases older than this one registered.
            let stale = [previousDisconnect].compactMap { $0 }
                + self.cappedStaleWorkSnapshot(olderThan: requestID) + pendingTasks
            var cappedRelease: CappedRelease?
            if disposition == .explicit, self.releaseFenceAvailable() {
                // Decision 094: the user's release waits for older work at
                // most `explicitReleaseDrainCap`, then runs. Whatever that
                // work sends later is refused by the helper's user-release
                // fence, and the release itself stops the Core and restores
                // DNS after the fence.
                if !(await self.waitForStaleWork(stale, self.explicitReleaseDrainCap, requestID)) {
                    LocalTrafficAudit.shared.recordEvent("explicit_release_drain_capped")
                    // From here until it ends, the stale work excludes every
                    // newer Connect and teardown (R10-F1). If it outlives
                    // this release, what it did is read back once, still
                    // under the generation this release settled with.
                    let release = CappedRelease()
                    cappedRelease = release
                    // Includes stale work an older release capped after this
                    // one started waiting; never a newer release's.
                    let lingering = stale + self.cappedStaleWorkSnapshot(olderThan: requestID)
                    let work = Task { @MainActor in
                        // Registered below before this body can run; only
                        // its own end removes it.
                        defer { self.cappedStaleWork[requestID] = nil }
                        for task in lingering { await task.value }
                        // A stale end before this release settled is
                        // covered by the release's own readback.
                        guard let afterLateDrain,
                              let generation = release.settledGeneration,
                              requestID == self.disconnectRequestID,
                              self.protectionOperationGeneration == generation else { return }
                        await afterLateDrain(generation)
                    }
                    self.cappedStaleWork[requestID] = work
                }
            } else {
                for task in stale { await task.value }
                // Stale work an older release capped after this request was
                // queued still owns effects; a teardown runs after it.
                await self.settleCappedStaleWork(olderThan: requestID)
            }
            await operation(requestID)
            cappedRelease?.settledGeneration = self.protectionOperationGeneration
            // An earlier request the cap stopped waiting for can settle later.
            self.settledDisconnectRequestID = max(self.settledDisconnectRequestID, requestID)
            if requestID == self.disconnectRequestID {
                self.explicitReleaseDeadlineTask?.cancel()
                self.explicitReleaseDeadlineTask = nil
                self.releaseStillFinishing = false
            }
        }
    }

    /// True when every task ended within `cap`; false at the cap, leaving
    /// the tasks running (awaiting a Task's value cannot be cancelled).
    static func waitAtMost(_ tasks: [Task<Void, Never>], cap: Duration) async -> Bool {
        guard !tasks.isEmpty else { return true }
        return await withCheckedContinuation { continuation in
            let once = ResumeOnce(continuation)
            let timer = Task { @MainActor in
                try? await Task.sleep(for: cap)
                once.resume(false)
            }
            Task { @MainActor in
                for task in tasks { await task.value }
                timer.cancel()
                once.resume(true)
            }
        }
    }

    /// The generation a capped release settled with; nil until it has.
    private final class CappedRelease {
        var settledGeneration: UInt64?
    }

    /// Resumes the capped wait exactly once: the drain or the cap, first wins.
    nonisolated private final class ResumeOnce: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<Bool, Never>?
        init(_ continuation: CheckedContinuation<Bool, Never>) { self.continuation = continuation }
        func resume(_ value: Bool) {
            let pending = lock.withLock { () -> CheckedContinuation<Bool, Never>? in
                defer { continuation = nil }
                return continuation
            }
            pending?.resume(returning: value)
        }
    }

    /// Starts the explicit release's overall UI deadline for the request just
    /// queued. When it passes before that request settles, `onOverdue`
    /// publishes the interim result; the queued operation still runs and
    /// publishes the final one through `completeDisconnect`.
    private func scheduleExplicitReleaseDeadline(_ onOverdue: @escaping @MainActor () -> Void) {
        explicitReleaseDeadlineTask?.cancel()
        let requestID = disconnectRequestID
        let deadline = explicitReleaseDeadline
        explicitReleaseDeadlineTask = Task { [weak self] in
            try? await Task.sleep(for: deadline)
            guard let self, !Task.isCancelled,
                  self.settledDisconnectRequestID < requestID else { return }
            self.releaseStillFinishing = true
            onOverdue()
        }
    }

    /// Earlier teardown still has to finish its privileged work, but cannot
    /// publish a stale result over a newer disconnect/release request's UI.
    func completeDisconnect(
        _ requestID: Int,
        releaseUnconfirmed: Bool = false,
        update: () -> Void
    ) {
        guard requestID == disconnectRequestID else { return }
        if !releaseUnconfirmed {
            disconnectQueueReleaseIntent = false
        }
        update()
    }

    /// A release request can arrive while Quit awaits helper IPC. Drain the
    /// newest queue tail too, so termination cannot exit before that user's
    /// explicit Restore finishes removing the narrow layer.
    func finishPendingDisconnect() async {
        var observedRequest: Int
        repeat {
            observedRequest = disconnectRequestID
            let pending = disconnectSequence
            await pending?.value
        } while observedRequest != disconnectRequestID
    }

    /// A Connect click during teardown is still a connection intent, not an
    /// unowned UI task. Replacing the request is single-flight, and a later
    /// Disconnect/Sign Out/Restore internet invalidates it before teardown can
    /// finish. Cancellation alone cannot interrupt an awaited Task.value.
    @discardableResult
    func connectAfterDisconnect(_ connect: @escaping @MainActor () -> Void) -> Task<Void, Never> {
        deferredConnect?.task.cancel()
        let requestID = UUID()
        let generation = protectionOperationGeneration
        let pendingDisconnect = disconnectSequence
        let task = Task { [weak self] in
            await pendingDisconnect?.value
            // R10-F1: nor before the stale work a capped release left running.
            await self?.settleCappedStaleWork()
            guard let self, !Task.isCancelled,
                  self.protectionOperationGeneration == generation,
                  self.deferredConnect?.id == requestID else { return }
            self.deferredConnect = nil
            connect()
        }
        deferredConnect = (requestID, task)
        return task
    }

    /// Final PF convergence is part of switch completion, not best-effort cleanup.
    /// A retired/cancelled switch leaves recovery to the newer teardown owner.
    func finishNodeSwitch(
        generation: UInt64,
        converge: () async throws -> Void,
        commit: () -> Void,
        recover: (Error) -> Void
    ) async -> Bool {
        guard !Task.isCancelled, protectionOperationGeneration == generation else { return false }
        do {
            try Task.checkCancellation()
            try await converge()
            try Task.checkCancellation()
        } catch {
            guard !Task.isCancelled, protectionOperationGeneration == generation else { return false }
            recover(error)
            return false
        }
        guard protectionOperationGeneration == generation else { return false }
        commit()
        return true
    }

    func bumpGeneration() {
        protectionOperationGeneration &+= 1
        cancelDeferredConnect()
    }

    /// Determines whether a reconnect kick should be debounced based on cooldown,
    /// or if scheduling should proceed. When an immediate kick is accepted,
    /// the previous reconnect task is safely cancelled.
    func shouldDebounceReconnectKick(immediate: Bool, now: Date = Date()) -> Bool {
        if immediate {
            if let lastKick = lastProtectedReconnectKick,
               now.timeIntervalSince(lastKick) < ProtectedReconnectSchedule.networkChangeKickCooldown,
               protectedReconnectTask != nil {
                return true
            }
            lastProtectedReconnectKick = now
            protectedReconnectTask?.cancel()
            protectedReconnectTask = nil
            protectedReconnectID = nil
            return false
        } else if protectedReconnectTask != nil {
            return true
        }
        return false
    }

    func cancelConnectionTasks() {
        connectTask?.cancel()
        connectTask = nil
        connectWatchdogTask?.cancel()
        connectWatchdogTask = nil
        connectAttemptID = nil
    }

    func cancelReconnectTasks() {
        protectedReconnectTask?.cancel()
        protectedReconnectTask = nil
        unarmedReconnectTask?.cancel()
        unarmedReconnectTask = nil
        unarmedReconnectOwner = nil
        protectedReconnectID = nil
        lastProtectedReconnectKick = nil
        wakeRecoveryTask?.cancel()
        wakeRecoveryTask = nil
        sleepRestrictTask?.cancel()
        sleepRestrictTask = nil
    }

    /// Coordinates initiating a connection: enforces single-flight deferred connect if teardown
    /// is in progress, manages watchdog and connect tasks, and fences with attemptID and generation.
    func executeConnect(
        isDisconnecting: Bool,
        deferredFallback: @escaping @MainActor () -> Void,
        prepare: () -> (canProceed: Bool, attemptID: UUID),
        watchdogSeconds: Double = 240,
        onWatchdog: @escaping @MainActor (UUID) async -> Void,
        perform: @escaping @MainActor (UUID, UInt64) async -> Void
    ) {
        if isDisconnecting {
            connectAfterDisconnect {
                deferredFallback()
            }
            return
        }
        let (canProceed, attemptID) = prepare()
        guard canProceed else { return }
        // Only an admitted attempt retires the previous generation. A connect
        // refused by `prepare` (already connecting, no ready exit) must not
        // retire the attempt in flight, whose tail compares the generation.
        bumpGeneration()
        // An admitted connect is the user's newer intent; it retires a release
        // that could not confirm PF was released. A connect refused by
        // `prepare` is not, so the intent survives it.
        disconnectQueueReleaseIntent = false
        explicitReleaseDominatesQuit = false

        let currentGeneration = protectionOperationGeneration
        connectAttemptID = attemptID

        connectWatchdogTask?.cancel()
        connectWatchdogTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(watchdogSeconds))
            guard let self, !Task.isCancelled,
                  self.connectAttemptID == attemptID else { return }
            await onWatchdog(attemptID)
        }

        connectTask = Task { [weak self] in
            guard let self, !Task.isCancelled,
                  self.protectionOperationGeneration == currentGeneration,
                  self.connectAttemptID == attemptID else { return }
            await perform(attemptID, currentGeneration)
        }
    }

    /// Coordinates the orderly teardown sequence: cancels active connect & reconnect tasks,
    /// enqueues teardown on disconnectSequence, ensures serialized execution, and notifies completion.
    func executeDisconnect(
        releaseKillSwitch: Bool,
        releaseDisposition: ReleaseDisposition? = nil,
        pendingTasks: [Task<Void, Never>],
        prepare: () -> Void,
        onOverdue: (@MainActor () -> Void)? = nil,
        afterLateDrain: (@MainActor (UInt64) async -> Void)? = nil,
        operation: @escaping @MainActor (Int) async -> Void
    ) {
        bumpGeneration()
        cancelConnectionTasks()
        if releaseKillSwitch {
            cancelReconnectTasks()
        }
        prepare()
        enqueueDisconnect(
            waitingFor: pendingTasks,
            releaseIntent: releaseKillSwitch,
            releaseDisposition: releaseDisposition,
            afterLateDrain: afterLateDrain,
            operation: operation
        )
        if let onOverdue { scheduleExplicitReleaseDeadline(onOverdue) }
    }

    /// Coordinates scheduling a protected reconnect attempt with exponential backoff and debouncing.
    func executeProtectedReconnect(
        immediate: Bool,
        now: Date = Date(),
        attempt: Int,
        computeDelay: (Int) -> TimeInterval = { attempt in
            ProtectedReconnectSchedule.backoffSeconds(attempt: attempt)
        },
        onScheduled: (TimeInterval) -> Void,
        perform: @escaping @MainActor (UUID) async -> Void
    ) {
        if shouldDebounceReconnectKick(immediate: immediate, now: now) {
            return
        }
        let delay = immediate ? 0 : computeDelay(attempt)
        let attemptID = UUID()
        protectedReconnectID = attemptID
        onScheduled(delay)
        protectedReconnectTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }
            guard let self, !Task.isCancelled,
                  self.protectedReconnectID == attemptID else { return }
            self.protectedReconnectTask = nil
            self.protectedReconnectID = nil
            await perform(attemptID)
        }
    }

    /// Coordinates running the protected reconnect loop, handling repeated attempts,
    /// backoff scheduling, and cleanup upon exit or connection success.
    func scheduleProtectedReconnectLoop(
        immediate: Bool,
        now: Date = Date(),
        onAttemptScheduled: @escaping @MainActor (Int, TimeInterval) -> Bool,
        onCleanup: @escaping @MainActor () -> Void,
        performAttempt: @escaping @MainActor () async -> Bool
    ) {
        if shouldDebounceReconnectKick(immediate: immediate, now: now) {
            return
        }

        let recoveryID = UUID()
        protectedReconnectID = recoveryID
        protectedReconnectTask = Task { [weak self] in
            defer {
                if let self, self.protectedReconnectID == recoveryID {
                    self.protectedReconnectTask = nil
                    self.protectedReconnectID = nil
                    onCleanup()
                }
            }

            let delays = ProtectedReconnectSchedule.delaysSeconds
            var attempt = 0
            while !Task.isCancelled {
                let delay = immediate && attempt == 0
                    ? 0
                    : delays[min(attempt, delays.count - 1)]
                let shouldContinue = onAttemptScheduled(attempt, TimeInterval(delay))
                guard shouldContinue else { return }

                if delay > 0 {
                    try? await Task.sleep(for: .seconds(TimeInterval(delay)))
                }
                guard !Task.isCancelled else { return }
                let didConnect = await performAttempt()
                if didConnect {
                    return
                }
                attempt += 1
            }
        }
    }

    private func cancelDeferredConnect() {
        deferredConnect?.task.cancel()
        deferredConnect = nil
    }
}
