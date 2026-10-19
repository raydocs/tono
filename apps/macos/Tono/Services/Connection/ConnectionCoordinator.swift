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
    /// Session intent survives automatic teardown/recovery, including failures
    /// before the runtime is built. Only an explicit release ends this choice.
    var capturedRoutingMode: String? = DesktopRoutingModeAdmission.persistedSession()
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

    /// The helper session that connect, reconnect and teardown tasks belong
    /// to. Each task captures the box current when it is created; a
    /// preemptive Restore replaces it, so late work from the earlier session
    /// is refused by the helper instead of touching the next one.
    private(set) var helperSession = HelperSessionGeneration()

    /// Retires every task of the current session for a preemptive Restore
    /// internet. Nothing is awaited: the release service ends the old
    /// writers, and the earlier session's late helper requests carry its
    /// generation. Teardowns still queued cannot publish over the result.
    /// An explicit release ends the session's mode. The AI Home record goes
    /// with it: a later arm is a new connect's, which captures again. Strict
    /// intent stays until Restore internet is confirmed.
    func retireCapturedRoutingMode() {
        capturedRoutingMode = nil
        AppProfile.defaults.removeObject(forKey: SettingsKey.aiHomeRoutingSession)
    }

    func beginPreemptiveRelease() {
        retireCapturedRoutingMode()
        bumpGeneration()
        cancelConnectionTasks()
        cancelReconnectTasks()
        nodeSwitchTask?.cancel()
        nodeSwitchTask = nil
        configReloadTask?.cancel()
        configReloadTask = nil
        coreMonitorTask?.cancel()
        coreMonitorTask = nil
        disconnectRequestID &+= 1
        disconnectQueueReleaseIntent = false
        explicitReleaseDominatesQuit = true
        helperSession.retire()
        helperSession = HelperSessionGeneration()
    }

    /// The user's own Connect: a session not yet admitted is replaced by one
    /// that may admit a released machine. Automatic connects keep the box
    /// they have, which cannot (R-F3).
    func beginUserConnect() {
        guard helperSession.value == nil, !helperSession.userInitiated else { return }
        helperSession.retire()
        helperSession = HelperSessionGeneration(userInitiated: true)
    }

    /// A preemptive release that could not confirm the network is restored
    /// keeps the release intent, like the queued path, until the user connects.
    func notePreemptiveReleaseUnconfirmed() {
        disconnectQueueReleaseIntent = true
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
        operation: @escaping @MainActor (Int) async -> Void
    ) {
        cancelDeferredConnect()
        disconnectRequestID &+= 1
        let requestID = disconnectRequestID
        let disposition = releaseDisposition ?? (releaseIntent ? .explicit : .preserve)
        if disposition == .explicit { retireCapturedRoutingMode() }
        if disposition == .explicit { explicitReleaseDominatesQuit = true }
        disconnectQueueReleaseIntent = releaseIntent
        let previousDisconnect = disconnectSequence
        let session = helperSession
        disconnectSequence = Task {
            await previousDisconnect?.value
            for task in pendingTasks { await task.value }
            await HelperSessionGeneration.$current.withValue(session) {
                await operation(requestID)
            }
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

        let session = helperSession
        connectTask = Task { [weak self] in
            guard let self, !Task.isCancelled,
                  self.protectionOperationGeneration == currentGeneration,
                  self.connectAttemptID == attemptID else { return }
            await HelperSessionGeneration.$current.withValue(session) {
                await perform(attemptID, currentGeneration)
            }
        }
    }

    /// Coordinates the orderly teardown sequence: cancels active connect & reconnect tasks,
    /// enqueues teardown on disconnectSequence, ensures serialized execution, and notifies completion.
    func executeDisconnect(
        releaseKillSwitch: Bool,
        releaseDisposition: ReleaseDisposition? = nil,
        pendingTasks: [Task<Void, Never>],
        prepare: () -> Void,
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
            operation: operation
        )
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
        let session = helperSession
        protectedReconnectTask = Task { [weak self] in
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }
            guard let self, !Task.isCancelled,
                  self.protectedReconnectID == attemptID else { return }
            self.protectedReconnectTask = nil
            self.protectedReconnectID = nil
            await HelperSessionGeneration.$current.withValue(session) {
                await perform(attemptID)
            }
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
        let session = helperSession
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
                let didConnect = await HelperSessionGeneration.$current.withValue(session) {
                    await performAttempt()
                }
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
