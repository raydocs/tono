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
    /// wake recovery (R1-F2).
    private var disconnectQueueReleaseIntent = false
    var nodeSwitchTask: Task<Void, Never>?
    var protectedReconnectTask: Task<Void, Never>?
    var protectedReconnectID: UUID?
    var lastProtectedReconnectKick: Date?
    var coreMonitorTask: Task<Void, Never>?
    var networkEnvironmentTask: Task<Void, Never>?
    var wakeRecoveryTask: Task<Void, Never>?
    var sleepRestrictTask: Task<Void, Never>?
    var configReloadTask: Task<Void, Never>?
    var configReloadRequestID = 0

    private var deferredConnect: (id: UUID, task: Task<Void, Never>)?

    /// Whether the pending or in-flight teardown queue's newest request is an
    /// explicit release. Newest-wins, matching `disconnectRequestID`: a later
    /// teardown request replaces the intent, and completion of the newest
    /// request retires it.
    var disconnectQueueRequestsRelease: Bool {
        disconnectQueueReleaseIntent
    }

    /// All teardown requests share one queue. Drain cancelled connection work
    /// before executing privileged stop/DNS/PF operations; cancelling a Task
    /// does not mean an in-flight helper request has stopped mutating the host.
    func enqueueDisconnect(
        waitingFor pendingTasks: [Task<Void, Never>] = [],
        releaseIntent: Bool,
        operation: @escaping @MainActor (Int) async -> Void
    ) {
        cancelDeferredConnect()
        disconnectRequestID &+= 1
        let requestID = disconnectRequestID
        disconnectQueueReleaseIntent = releaseIntent
        let previousDisconnect = disconnectSequence
        disconnectSequence = Task {
            await previousDisconnect?.value
            for task in pendingTasks { await task.value }
            await operation(requestID)
        }
    }

    /// Earlier teardown still has to finish its privileged work, but cannot
    /// publish a stale result over a newer disconnect/release request's UI.
    func completeDisconnect(_ requestID: Int, update: () -> Void) {
        guard requestID == disconnectRequestID else { return }
        disconnectQueueReleaseIntent = false
        update()
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
        bumpGeneration()
        let (canProceed, attemptID) = prepare()
        guard canProceed else { return }

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
