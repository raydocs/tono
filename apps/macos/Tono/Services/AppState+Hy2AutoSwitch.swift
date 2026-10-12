import Foundation

/// A17 wiring. Every hook only reads or swaps the in-memory selection a
/// connect attempt dials; PF endpoints follow that selection exactly as they
/// do for a manual hy2 pick (`ConfigPipeline.dialEndpoints(for:)`).
extension AppState {
    /// Before a new attempt is judged: put back the user's Reality block if
    /// the selection is still the previous attempt's automatic hy2 dial.
    func restoreSelectionAfterHy2AutoDial() {
        if let tcp = hy2AutoSwitch.selectionToRestore(current: currentProxySelectionTarget()) {
            _ = applyProxySelection(tcp)
        }
    }

    /// An admitted connect attempt: dial the same node's hy2 block when the
    /// catalog permits it and Reality has failed enough, or a recent automatic
    /// hy2 success is remembered for this node.
    func applyHy2AutoSwitchForConnect(now: Date = Date()) {
        guard let dial = hy2AutoSwitch.beginAttempt(
            selected: selectedExitNode(),
            catalog: managedCatalogNodes,
            owner: ManagedExitCatalogOwnership.currentAccount,
            now: now
        ) else { return }
        guard applyProxySelection(dial.hy2) else {
            hy2AutoSwitch.abandonAttempt()
            return
        }
        LocalTrafficAudit.shared.recordEvent(
            "hy2_auto_switch",
            details: [
                "from": dial.tcp,
                "to": dial.hy2,
                "reason": dial.remembered ? "remembered" : "tcp_failures",
            ]
        )
    }

    /// A connect attempt that dialed `dialed` failed. A failed automatic hy2
    /// attempt hands the selection back to the Reality block.
    func noteHy2AutoSwitchConnectFailure(dialed: String, now: Date = Date()) {
        guard let tcp = hy2AutoSwitch.noteConnectFailure(
            dialed: dialed,
            code: lastClassifiedFailure?.code,
            now: now
        ) else { return }
        LocalTrafficAudit.shared.recordEvent(
            "hy2_auto_switch_failed",
            details: ["from": dialed, "to": tcp]
        )
        if currentProxySelectionTarget() == dialed {
            _ = applyProxySelection(tcp)
        }
    }

    /// An exit-catalog 200 that was refused, or whose body did not decode:
    /// it grants nothing, so no automatic hy2 until an accepted 200 does.
    func revokeHy2AutoSwitchForRejectedCatalog() {
        hy2AutoSwitch.revoke()
    }

    /// Exit-catalog 200 for `owner`, after its install (or no-op install).
    func applyHy2AutoSwitchPermission(_ permitted: Bool, owner: String) {
        guard ManagedExitCatalogOwnership.currentAccount == owner else { return }
        hy2AutoSwitch.applyCatalogPermission(permitted, owner: owner, catalog: managedCatalogNodes)
    }
}
