import Foundation

// MARK: - Runtime Cleanup

enum RuntimeCleanup {
    static func markCoreStarted(tunEnabled: Bool) {
        AppProfile.defaults.set(true, forKey: SettingsKey.didStartCore)
        AppProfile.defaults.set(tunEnabled, forKey: SettingsKey.lastTunEnabled)
    }

    static func clearCoreStarted() {
        AppProfile.defaults.removeObject(forKey: SettingsKey.didStartCore)
        AppProfile.defaults.removeObject(forKey: SettingsKey.lastTunEnabled)
    }

    /// A post-update first launch carries the handoff journal, and this is the
    /// step it describes: the recovery below is what resumes protection on the
    /// new build, or fails to. On any other launch there is no journal and this
    /// does nothing.
    private static func recordUpdateHandoff(
        _ phase: UpdateHandoffPhase,
        errorCode: ProtectedFailureCode? = nil,
        errorStage: String? = nil
    ) {
        guard let journal = UpdateHandoffStore.load() else { return }
        try? UpdateHandoffStore.write(journal.advancing(
            to: phase,
            errorCode: errorCode?.rawValue,
            errorStage: errorStage
        ))
    }

    /// Recover a previous process's network mutations transactionally before
    /// account restoration performs any request. If protection had been active,
    /// PF stays armed with only Tono's bounded control-plane recovery exception
    /// until a verified session reconnects or the user explicitly disarms it.
    static func cleanupStaleRuntime() async throws -> Bool {
        do {
            return try await recoverStaleRuntime()
        } catch {
            // Every throwing exit of the recovery is a launch that could not
            // restore the previous runtime. After an update that is exactly
            // where the recovery failed, so name it before the error surfaces
            // as a generic start failure.
            recordUpdateHandoff(
                .failed,
                errorCode: .updateRecoveryFailed,
                errorStage: "cleanupStaleRuntime"
            )
            throw error
        }
    }

    private static func recoverStaleRuntime() async throws -> Bool {
        await PrivilegedRuntimeCoordinator.shared.cleanupStaleSystemProxy()
        // A daemon that refuses this app's identity fails every status, arm,
        // stop, and DNS call below with Forbidden, and no retry of this launch
        // sequence can change that outcome — the host would stay fail-closed
        // behind an unexplained startup error. The authenticated reinstall is
        // the one path that does not depend on the rejecting socket, so run it
        // first, before any step below trusts a helper answer.
        if await PrivilegedRuntimeCoordinator.shared.daemonRejectsClient() {
            do {
                try await PrivilegedRuntimeCoordinator.shared.prepareHelper()
            } catch {
                throw CoreRuntimeError.startFailed(
                    String(localized: "The installed network helper no longer accepts this copy of Tono. Click Retry and approve the administrator prompt to repair it, or run the documented sudo emergency-disarm command and reopen Tono. \(error.localizedDescription)")
                )
            }
        }
        let localProtectionIntent = KillSwitchService.isArmed
        let helperProtectionObservation =
            await PrivilegedRuntimeCoordinator.shared.refreshKillSwitchStatus()
        let shouldResumeProtection: Bool
        switch helperProtectionObservation {
        case .confirmed(let requiresProtectionRecovery):
            // An authenticated helper status is authoritative. In particular,
            // root emergency recovery clears helper-owned PF state but cannot
            // update this user's defaults; do not let that stale local bit
            // immediately re-arm the machine on reopen.
            KillSwitchService.isArmed = requiresProtectionRecovery
            shouldResumeProtection = requiresProtectionRecovery
        case .unavailable, .rejected:
            // Timeout, malformed status, and 403 are never evidence that PF is
            // open. Preserve the last local fail-closed intent.
            shouldResumeProtection = localProtectionIntent
        }

        if shouldResumeProtection {
            recordUpdateHandoff(.protectionResuming)
            // Remove stale TUN/proxy exceptions and retain the persisted exact
            // control-plane HTTPS addresses before stopping the old core. A
            // failed reassert leaves the previous PF block live, so cleanup can
            // still continue without ever opening unrestricted egress.
            try? await PrivilegedRuntimeCoordinator.shared
                .reassertKillSwitchIfNeeded()
        }

        let didStartCore = AppProfile.defaults.bool(forKey: SettingsKey.didStartCore)
        let coreStatus = await PrivilegedRuntimeCoordinator.shared.coreStatus()
        let coreMayStillBeRunning = didStartCore
            || (coreStatus.verified && coreStatus.running)
        if coreMayStillBeRunning {
            do {
                try await PrivilegedRuntimeCoordinator.shared.stopCore()
            } catch {
                let status = await PrivilegedRuntimeCoordinator.shared.coreStatus()
                let confirmedStopped = status.verified && !status.running
                guard confirmedStopped else {
                    throw CoreRuntimeError.startFailed(
                        "A previous protected core could not be stopped safely."
                    )
                }
            }
            clearCoreStarted()
        }

        // Restore DNS while PF remains armed. A fresh installation or a legacy
        // helper has no DNS endpoint and therefore nothing to recover.
        //
        // A missing snapshot is not evidence that nothing needs recovering. A
        // force-kill between `removeSnapshot` and the last `networksetup` call
        // leaves the Mihomo resolver on a live service with no snapshot at all,
        // and the core this launch just stopped is what that resolver pointed
        // at. The helper sweeps exactly that case, so ask for the restore
        // whenever this Mac may have been protected — gating on the snapshot
        // was what kept the sweep from ever running at launch.
        let protectedDNS =
            await PrivilegedRuntimeCoordinator.shared.protectedDNSStatus()
        if protectedDNS.available,
           protectedDNS.snapshotPresent || didStartCore || shouldResumeProtection {
            _ = try await PrivilegedRuntimeCoordinator.shared
                .restoreProtectedDNSIfConfigured()
        } else if !protectedDNS.available,
                  didStartCore || shouldResumeProtection {
            // An armed host whose helper cannot report DNS state (a legacy
            // daemon without the DNS contract, or one that stopped answering)
            // is unrecoverable over IPC, and retrying this launch sequence
            // could never end differently. Upgrade through the authenticated
            // install path once before declaring the launch failed.
            var repaired = false
            do {
                try await PrivilegedRuntimeCoordinator.shared.prepareHelper()
                let recheck = await PrivilegedRuntimeCoordinator.shared
                    .protectedDNSStatus()
                if recheck.snapshotPresent {
                    _ = try await PrivilegedRuntimeCoordinator.shared
                        .restoreProtectedDNSIfConfigured()
                    repaired = true
                } else {
                    repaired = recheck.available
                }
            } catch {
                // Losing the real cause here (most often a cancelled
                // administrator prompt) would present the unrelated DNS
                // message below and leave the user guessing.
                throw CoreRuntimeError.startFailed(
                    "The network helper needs repair before its protected "
                    + "DNS state can be inspected. Click Retry and approve "
                    + "the administrator prompt, or run the documented sudo "
                    + "emergency-disarm command and reopen Tono. "
                    + error.localizedDescription
                )
            }
            if !repaired {
                throw CoreRuntimeError.startFailed(
                    "A previous protected DNS state could not be inspected "
                    + "safely. Click Retry and approve the administrator "
                    + "prompt to repair the network helper, or run the "
                    + "documented sudo emergency-disarm command and reopen "
                    + "Tono."
                )
            }
        }
        return shouldResumeProtection
    }
}
