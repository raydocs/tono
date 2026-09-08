import Foundation

/// Owns account work and the cleanup barrier. A cancelled sign-in may still
/// finish a non-cooperative side effect; cleanup must drain it before releasing
/// protection or clearing credentials, and no new sign-in may cross that barrier.
@MainActor
final class AccountLifecycleCoordinator {
    enum CleanupKind { case signOut, releaseProtection }
    private var generation: UInt64 = 0
    private var work: (id: UUID, task: Task<Void, Never>)?
    private var cleanup: (id: UUID, kind: CleanupKind, task: Task<Void, Never>)?

    var isBusy: Bool { work != nil || cleanup != nil }

    func run(_ operation: @escaping @MainActor () async -> Void) async {
        let requestedGeneration = generation
        guard cleanup == nil, !Task.isCancelled else { return }
        if let current = work {
            // Duplicate form submits join rather than send a second challenge.
            await current.task.value
            guard !Task.isCancelled, requestedGeneration == generation,
                  cleanup == nil, current.task.isCancelled else { return }
            // A replacement SwiftUI task may restart a cancelled restore, but
            // an intent predating cleanup must never restart after that cleanup.
            if work?.id == current.id { work = nil }
        }
        guard work == nil, cleanup == nil else { return }
        let id = UUID()
        let task = Task {
            guard !Task.isCancelled else { return }
            await operation()
        }
        work = (id, task)
        await withTaskCancellationHandler {
            await task.value
        } onCancel: {
            task.cancel()
        }
        if work?.id == id { work = nil }
    }

    @discardableResult
    func enqueueCleanup(
        kind: CleanupKind,
        operation: @escaping @MainActor () async -> Void
    ) -> Task<Void, Never> {
        if let current = cleanup, current.kind == kind { return current.task }
        generation &+= 1
        let pending = work
        pending?.task.cancel()
        let previousCleanup = cleanup?.task
        let id = UUID()
        let task = Task {
            await previousCleanup?.value
            await pending?.task.value
            if work?.id == pending?.id { work = nil }
            await operation()
            if cleanup?.id == id { cleanup = nil }
        }
        cleanup = (id, kind, task)
        return task
    }
}
