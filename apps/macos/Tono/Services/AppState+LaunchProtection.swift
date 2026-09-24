import Foundation

extension AppState {
    /// Launch recovery's verdict on a barrier an earlier session left behind.
    /// Only a helper-confirmed barrier becomes Protected Offline, the same
    /// state an in-session failure publishes; a stored intent the helper did
    /// not answer for stays unconfirmed. A session that is already running
    /// or tearing down publishes its own verdict.
    func adoptLaunchProtection(_ protection: RuntimeCleanup.LaunchProtection) {
        launchProtectionSequence &+= 1
        guard !isConnected, !isConnecting, !isDisconnecting else { return }
        switch protection {
        case .held:
            isProtectionBlocked = true
        case .unconfirmed:
            if !isProtectionBlocked { isProtectionUnconfirmed = true }
        case .released:
            if isProtectionBlocked {
                // An authenticated answer says nothing is held: retire a
                // stale Protected Offline the way the activation reconcile
                // retires a confirmed external release.
                acceptConfirmedExternalProtectionRelease()
            } else {
                isProtectionUnconfirmed = false
            }
        }
    }

    /// Folds a later authenticated helper answer into an unconfirmed launch
    /// verdict. Never prompts; an unavailable or rejected answer changes
    /// nothing, and neither does a verdict some transition published meanwhile
    /// — including a launch verdict that leaves the launch still unconfirmed.
    /// A protection operation that began meanwhile (a sleep or wake) moves
    /// the protection generation but not the launch sequence; its recovery
    /// reasserts the stored intent, so the older answer must not retire it.
    func resolveUnconfirmedProtection() async {
        guard isProtectionUnconfirmed else { return }
        let sequence = launchProtectionSequence
        let generation = connectionCoordinator.protectionOperationGeneration
        let observation = await networkProtection.refreshKillSwitchStatus()
        guard !Task.isCancelled, isProtectionUnconfirmed,
              launchProtectionSequence == sequence,
              connectionCoordinator.protectionOperationGeneration == generation else { return }
        guard case .confirmed(let requiresProtectionRecovery) = observation else { return }
        KillSwitchService.isArmed = requiresProtectionRecovery
        adoptLaunchProtection(requiresProtectionRecovery ? .held : .released)
    }
}
