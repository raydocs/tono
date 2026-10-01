import SwiftUI

enum RecoveryCause {
    case networkChange, wake

    var title: String {
        switch self {
        case .networkChange: String(localized: "Network changed")
        case .wake: String(localized: "Waking this Mac")
        }
    }
}

extension AppState {
    var recoveryFeedback: String? {
        guard recoveryCause != nil else { return nil }
        if isConnected && !isProxyDegraded {
            return String(localized: "Recovery completed through the existing protected connection flow.")
        }
        if protectedReconnectPausedForUserAction {
            return String(localized: "Recovery paused. Use Repair and reconnect; approve the macOS administrator prompt only from a signed Tono app. Protection has not been intentionally released.")
        }
        if isConnecting || isDisconnecting || isProtectedReconnectScheduled {
            return String(localized: "Tono is recovering the protected route. No alternate exit is selected automatically. Keep the Mac awake and wait for the connection result.")
        }
        if isProtectionBlocked {
            return String(localized: "Recovery has not completed. Retry now uses the same protection owner; it does not reset the network or release protection.")
        }
        return nil
    }
}

struct RecoveryNotice: View {
    let appState: AppState

    var body: some View {
        if let cause = appState.recoveryCause, let feedback = appState.recoveryFeedback {
            VStack(alignment: .leading, spacing: 4) {
                Label(cause.title, systemImage: "arrow.clockwise.shield")
                    .font(.system(size: 12, weight: .semibold))
                Text(feedback).font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("protectedRecoveryFeedback")
        }
    }
}
