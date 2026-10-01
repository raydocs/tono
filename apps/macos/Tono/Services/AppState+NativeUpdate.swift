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

    func suspendForNativeUpdate() async {
        connectionCoordinator.bumpGeneration()
        let retirementGeneration = connectionCoordinator.protectionOperationGeneration
        let tasks = [connectionCoordinator.coreMonitorTask, connectionCoordinator.nodeSwitchTask,
                     connectionCoordinator.protectedReconnectTask, connectionCoordinator.connectTask,
                     connectionCoordinator.configReloadTask, connectionCoordinator.networkEnvironmentTask,
                     connectionCoordinator.wakeRecoveryTask, connectionCoordinator.sleepRestrictTask]
            .compactMap { $0 }
        for task in tasks { task.cancel() }
        resumeProtectionAfterWake = false
        // A cancelled reload may return without clearing its serialization
        // handle. Retire its completion and queued work before draining it;
        // neither may start another mutation during the helper handoff.
        connectionCoordinator.configReloadRequestID &+= 1
        let reloadRetirementID = connectionCoordinator.configReloadRequestID
        pendingFullConfigReload = false
        pendingDirectPolicyReload = nil
        isConnected = false
        isConnecting = false
        isProtectedReconnectScheduled = false
        autoConnectRequested = false
        stopProxyGuard()
        stopLatencyTestTimer()
        for task in tasks { await task.value }
        // Wake retries check cancellation, not the protection generation. They
        // must drain before update release, or a later retry can reconnect once
        // retirement clears the update gates. Keep the handles until that drain.
        if connectionCoordinator.protectionOperationGeneration == retirementGeneration {
            connectionCoordinator.wakeRecoveryTask = nil
            connectionCoordinator.sleepRestrictTask = nil
        }
        if connectionCoordinator.configReloadRequestID == reloadRetirementID {
            connectionCoordinator.configReloadTask = nil
        }
        webSocket?.stopAll()
        webSocket = nil
        coreController = nil
        proxyService.setAPI(nil)
        // Root performs Core/TUN/DNS cleanup; no App-owned disconnect or
        // journal is treated as its proof.
    }

    func disconnectPendingNativeUpdate(preserveAIHold: Bool = false) {
        guard nativeUpdateDisconnectTask == nil else { return }
        nativeUpdatePending = true
        RuntimeCleanup.nativeUpdateBlocksConnect = true
        nativeUpdateDisconnectTask = Task {
            defer { nativeUpdateDisconnectTask = nil }
            await suspendForNativeUpdate()
            let generation = connectionCoordinator.protectionOperationGeneration
            guard !Task.isCancelled else { return }
            isProtectionBlocked = false
            isProtectionUnconfirmed = true
            do {
                let result = try await (preserveAIHold
                    ? nativeUpdateReleaseAfterFailure() : nativeUpdateDisconnect())
                guard !Task.isCancelled,
                      connectionCoordinator.protectionOperationGeneration == generation else { return }
                guard result.disconnectVerified == true else { throw NativeUpdateDownload.failure("Update Disconnect was not verified.") }
                launchProtectionSequence &+= 1
                isProtectionBlocked = false
                KillSwitchService.isArmed = false
                resetReleasedSessionHistory()
                RuntimeCleanup.clearCoreStarted()
            } catch {
                guard !Task.isCancelled,
                      connectionCoordinator.protectionOperationGeneration == generation else { return }
                // The helper may have released PF before the reply or ledger
                // write failed. Until a live readback arrives, neither the old
                // cached intent nor this error proves protection is held.
                isProtectionBlocked = false
                isProtectionUnconfirmed = true
                guard await refreshNativeUpdateProtectionStatus() else { return }
                guard !Task.isCancelled,
                      connectionCoordinator.protectionOperationGeneration == generation else { return }
                errorMessage = error.localizedDescription
            }
        }
    }

    /// Read-only PF reconciliation: desired intent alone is not live protection.
    /// This never acknowledges Core/DNS cleanup or retires the pending receipt.
    @discardableResult
    func refreshNativeUpdateProtectionStatus() async -> Bool {
        let generation = connectionCoordinator.protectionOperationGeneration
        let sequence = launchProtectionSequence
        let health = await protectionAudits.killSwitchHealth()
        guard !Task.isCancelled,
              nativeUpdatePending || RuntimeCleanup.nativeUpdatePending
                || RuntimeCleanup.nativeUpdateBlocksConnect,
              connectionCoordinator.protectionOperationGeneration == generation,
              launchProtectionSequence == sequence else { return false }
        launchProtectionSequence &+= 1
        guard let health else {
            isProtectionBlocked = false
            isProtectionUnconfirmed = true
            return true
        }
        // The current helper maps an unreadable PF status to live=false.
        // A live reading proves a barrier; a non-live reading cannot certify
        // release, even if the intent file is absent. Only the verified
        // Disconnect reply may settle release and clear local recovery intent.
        if health.wanted || health.live { KillSwitchService.isArmed = true }
        isProtectionBlocked = health.live
        isProtectionUnconfirmed = !health.live
        return true
    }

    /// The retry button explicitly requests Internet release. Root rechecks
    /// cleanup and archives the receipt; unconsumed reservations retire as
    /// before, and a consumed-side attempt retires only after the privileged
    /// resolved predicates hold (verified Disconnect plus on-disk component
    /// proof). Consumed evidence is archived, never fabricated into commit.
    func retireDisconnectedNativeUpdate(
        nativeUpdate: (String) async throws -> HelperManager.UpdateStatus = {
            try await PrivilegedRuntimeCoordinator.shared.nativeUpdate($0)
        }
    ) async throws {
        let pending = try await nativeUpdate("status")
        guard pending.pending, AppUpdater.disconnectRetriable(pending) else {
            throw NativeUpdateDownload.failure("This attempt cannot be retried before installation recovery.")
        }
        nativeUpdatePending = true
        await suspendForNativeUpdate()
        let released = try await nativeUpdate("disconnect")
        guard released.disconnectVerified == true else { throw NativeUpdateDownload.failure("Update Disconnect was not verified.") }
        // An evidence archive failure cannot undo verified PF release.
        // Publish it before retirement so the UI cannot retain protection.
        launchProtectionSequence &+= 1
        KillSwitchService.isArmed = false
        isProtectionBlocked = false
        resetReleasedSessionHistory()
        let retired = try await nativeUpdate("retire")
        guard !retired.pending else { throw NativeUpdateDownload.failure("Update retirement did not commit.") }
        nativeUpdatePending = false
        RuntimeCleanup.nativeUpdatePending = false
        RuntimeCleanup.nativeUpdateBlocksConnect = false
        RuntimeCleanup.nativeUpdateRecovery = nil
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
