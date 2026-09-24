import SwiftUI

/// What the account gate says about a fail-closed barrier.
enum GateProtectionNotice: Equatable {
    case blocking
}

extension AppState {
    /// The account gate's barrier notice. nil hides the section and its
    /// Restore internet button.
    var gateProtectionNotice: GateProtectionNotice? {
        KillSwitchService.isArmed ? .blocking : nil
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
    /// isArmed is a plain static (not observable), so the local flag forces
    /// the section to update once this button's restore completes.
    @State private var restoredInternetFromGate = false

    var body: some View {
        if appState.gateProtectionNotice != nil, !restoredInternetFromGate {
            Divider().padding(.vertical, 4)
            Label(
                "Kill Switch is blocking direct Internet from an earlier session.",
                systemImage: "shield.slash"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
            Button("Restore internet (turn off protection)") {
                Task {
                    await session.restoreDirectInternet()
                    restoredInternetFromGate = !KillSwitchService.isArmed
                }
            }
            .disabled(disabled)
        }
    }
}
