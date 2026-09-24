import Foundation

extension AppState {
    /// Launch recovery's verdict on a barrier an earlier session left behind.
    /// Only a helper-confirmed barrier becomes Protected Offline, the same
    /// state an in-session failure publishes; a stored intent the helper did
    /// not answer for stays unconfirmed. A session that is already running
    /// or tearing down publishes its own verdict.
    func adoptLaunchProtection(_ protection: RuntimeCleanup.LaunchProtection) {
        guard !isConnected, !isConnecting, !isDisconnecting else { return }
        switch protection {
        case .held:
            isProtectionBlocked = true
        case .unconfirmed:
            if !isProtectionBlocked { isProtectionUnconfirmed = true }
        case .released:
            isProtectionUnconfirmed = false
        }
    }
}
