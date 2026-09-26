import Foundation

extension AppState {
    func installNativeUpdate(manifest: Data, signature: Data, package: URL) async throws {
        let coordinator = PrivilegedRuntimeCoordinator.shared
        nativeUpdatePending = true
        do {
            let status = try await NativeUpdatePreparation.run(
                stage: { try await coordinator.stageUpdate(manifest: manifest, signature: signature, package: package) },
                suspend: { await self.suspendForNativeUpdate() },
                prepare: { try await coordinator.nativeUpdate("prepare") },
                execute: { try await coordinator.nativeUpdate("execute") },
                query: { try await coordinator.nativeUpdate("status") }
            )
            RuntimeCleanup.nativeUpdatePending = true
            isProtectionBlocked = status.receipt?.requiredRecovery != .unprotected
        } catch {
            // Unreachable is pending, never a reason to run ordinary cleanup.
            let status = try? await coordinator.nativeUpdate("status")
            if let status {
                nativeUpdatePending = status.pending
                RuntimeCleanup.nativeUpdatePending = status.pending
            }
            // Suspension already cleared isConnected; a barrier that is still
            // armed must read as blocked, never as Standby. Only ever raised.
            if !isConnected, KillSwitchService.isArmed
                || (status?.pending == true && status?.receipt?.requiredRecovery != .unprotected) {
                isProtectionBlocked = true
            }
            throw error
        }
    }

    private func suspendForNativeUpdate() async {
        connectionCoordinator.bumpGeneration()
        let tasks = [connectionCoordinator.coreMonitorTask, connectionCoordinator.nodeSwitchTask,
                     connectionCoordinator.protectedReconnectTask, connectionCoordinator.connectTask,
                     connectionCoordinator.configReloadTask, connectionCoordinator.networkEnvironmentTask]
            .compactMap { $0 }
        for task in tasks { task.cancel() }
        isProtectedReconnectScheduled = false
        autoConnectRequested = false
        stopProxyGuard()
        stopLatencyTestTimer()
        for task in tasks { await task.value }
        webSocket?.stopAll()
        webSocket = nil
        coreController = nil
        proxyService.setAPI(nil)
        isConnected = false
        isConnecting = false
        // Root performs Core/TUN/DNS cleanup; no App-owned disconnect or
        // journal is treated as its proof.
    }

    func disconnectPendingNativeUpdate() {
        guard nativeUpdateDisconnectTask == nil else { return }
        nativeUpdatePending = true
        RuntimeCleanup.nativeUpdateBlocksConnect = true
        nativeUpdateDisconnectTask = Task {
            defer { nativeUpdateDisconnectTask = nil }
            await suspendForNativeUpdate()
            do {
                let result = try await PrivilegedRuntimeCoordinator.shared.nativeUpdate("disconnect")
                guard result.disconnectVerified == true else { throw NativeUpdateDownload.failure("Update Disconnect was not verified.") }
                isProtectionBlocked = false
                KillSwitchService.isArmed = false
                resetReleasedSessionHistory()
                RuntimeCleanup.clearCoreStarted()
            } catch {
                isProtectionBlocked = true
                errorMessage = error.localizedDescription
            }
        }
    }

    /// The retry button explicitly requests Internet release. Root rechecks
    /// cleanup and archives the receipt; unconsumed reservations retire as
    /// before, and a consumed-side attempt retires only after the privileged
    /// resolved predicates hold (verified Disconnect plus on-disk component
    /// proof). Consumed evidence is archived, never fabricated into commit.
    func retireDisconnectedNativeUpdate() async throws {
        let coordinator = PrivilegedRuntimeCoordinator.shared
        let pending = try await coordinator.nativeUpdate("status")
        guard pending.pending, AppUpdater.disconnectRetriable(pending) else {
            throw NativeUpdateDownload.failure("This attempt cannot be retried before installation recovery.")
        }
        nativeUpdatePending = true
        await suspendForNativeUpdate()
        let released = try await coordinator.nativeUpdate("disconnect")
        guard released.disconnectVerified == true else { throw NativeUpdateDownload.failure("Update Disconnect was not verified.") }
        let retired = try await coordinator.nativeUpdate("retire")
        guard !retired.pending else { throw NativeUpdateDownload.failure("Update retirement did not commit.") }
        nativeUpdatePending = false
        RuntimeCleanup.nativeUpdatePending = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdateRecovery = nil
        KillSwitchService.isArmed = false
        isProtectionBlocked = false
        resetReleasedSessionHistory()
        updateIncomplete = UpdateHandoffStore.showsIncompleteUpdate()
        errorMessage = nil
        RuntimeCleanup.clearCoreStarted()
    }
}

/// The active caller's ordering, with a narrow transport seam for XCTest.
/// Phases received here are display/control data, not installation authority.
@MainActor
enum NativeUpdatePreparation {
    static func run(
        stage: () async throws -> HelperManager.UpdateStatus,
        suspend: () async -> Void,
        prepare: () async throws -> HelperManager.UpdateStatus,
        execute: () async throws -> HelperManager.UpdateStatus,
        query: () async throws -> HelperManager.UpdateStatus
    ) async throws -> HelperManager.UpdateStatus {
        let staged = try await stage()
        guard staged.pending, staged.execution == "staged", let receipt = staged.receipt,
              receipt.phase == .preparing, receipt.blockedReason == nil else {
            throw NativeUpdateDownload.failure("Helper did not verify private update staging.")
        }
        await suspend()
        let prepared = try await prepare()
        guard prepared.receipt?.attemptId == receipt.attemptId,
              prepared.receipt?.phase == .installationAuthorized,
              prepared.receipt?.blockedReason == nil else {
            throw NativeUpdateDownload.failure("Helper did not authorize protected update preparation.")
        }
        let consumed: HelperManager.UpdateStatus
        do { consumed = try await execute() }
        catch { consumed = try await query() } // Never repeat installation after a lost ACK.
        guard consumed.receipt?.attemptId == receipt.attemptId,
              consumed.receipt?.blockedReason == nil, consumed.execution == "consumed" else {
            throw NativeUpdateDownload.failure("Update consumption is uncertain. Keep protection and query recovery.")
        }
        return consumed
    }
}

/// Helper I/O of the connect tail that resumes an adopted native update.
/// Tests replace it to hold the status query while the attempt is retired.
struct NativeUpdateResumeOperations {
    var pending: () async throws -> HelperManager.UpdateStatus? = {
        try await PrivilegedRuntimeCoordinator.shared.pendingNativeUpdate()
    }
    var commit: () async throws -> Void = {
        _ = try await PrivilegedRuntimeCoordinator.shared.nativeUpdate("commit")
    }
}
