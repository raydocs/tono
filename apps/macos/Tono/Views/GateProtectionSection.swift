import SwiftUI

/// What the account gate says about a fail-closed barrier. Derived from the
/// same observable AppState the menu bar reads, so a Restore internet finished
/// anywhere (menu bar, this gate, a teardown) re-evaluates a mounted gate.
enum GateProtectionNotice: Equatable {
    /// A published verdict, or a live session, holds the barrier.
    case blocking
    /// A stored fail-closed intent that no helper answer has confirmed.
    case unconfirmed
    case selectiveRecovery

    var message: LocalizedStringKey {
        switch self {
        case .blocking:
            "Kill Switch is blocking direct Internet from an earlier session."
        case .selectiveRecovery:
            "AI recovery rules may still be active. Restore internet to remove them."
        case .unconfirmed:
            "Protection from an earlier session could not be confirmed. Direct Internet may still be blocked."
        }
    }

    var symbolName: String {
        switch self {
        case .blocking: "shield.slash"
        case .unconfirmed: "exclamationmark.shield"
        case .selectiveRecovery: "shield.lefthalf.filled"
        }
    }
}

extension AppState {
    /// The account gate's barrier notice. nil hides the section and its
    /// Restore internet button; it is shown exactly when the menu bar offers
    /// Restore internet to an account that is not ready.
    var gateProtectionNotice: GateProtectionNotice? {
        // A helper that rejects this copy of Tono cannot say whether its
        // watchdog lifted the block; the menu bar says unknown, and so does
        // the gate. Restore internet stays.
        if isProtectionBlockUnreadable { return .unconfirmed }
        if isProtectionBlocked || isConnected { return .blocking }
        // The stored intent keeps the escape hatch reachable on a path that
        // has published no verdict, without claiming a block nobody confirmed.
        if isProtectionUnconfirmed || KillSwitchService.isArmed { return .unconfirmed }
        if selectiveAIRecoveryPending { return .selectiveRecovery }
        return nil
    }
}

/// The account gate's fail-closed escape hatch, shared by the sign-in and
/// blocked-account screens. A fail-closed host whose session cannot reach
/// .ready (crash recovery with an unreachable control plane, an expired
/// plan whose renewal page needs a browser) otherwise has no way to restore
/// internet short of signing out.
struct GateProtectionSection: View {
    let session: AccountSession
    var disabled = false
    @Environment(AppState.self) private var appState

    var body: some View {
        if let notice = appState.gateProtectionNotice {
            Divider().padding(.vertical, 4)
            Label(notice.message, systemImage: notice.symbolName)
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("Restore internet (turn off protection)") {
                Task { await session.restoreDirectInternet() }
            }
            .disabled(disabled)
        }
    }
}
