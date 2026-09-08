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

    /// All teardown requests share one queue. Drain cancelled connection work
    /// before executing privileged stop/DNS/PF operations; cancelling a Task
    /// does not mean an in-flight helper request has stopped mutating the host.
    func enqueueDisconnect(
        waitingFor pendingTasks: [Task<Void, Never>] = [],
        operation: @escaping @MainActor (Int) async -> Void
    ) {
        cancelDeferredConnect()
        disconnectRequestID &+= 1
        let requestID = disconnectRequestID
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

    func bumpGeneration() {
        protectionOperationGeneration &+= 1
        cancelDeferredConnect()
    }

    private func cancelDeferredConnect() {
        deferredConnect?.task.cancel()
        deferredConnect = nil
    }
}
