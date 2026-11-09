import SwiftUI

/// One derivation for the menu-bar extra header and the status-item symbol.
/// Six shapes carry state at a glance: MenuBarExtra renders template images,
/// so color is not visible in the extra itself and must not be relied on there.
/// The shapes are the sun-on-the-horizon family (`MenuBarStatus*` image sets,
/// written by apps/windows/app/scripts/generate-tono-icons.py): only a verified
/// connection gets the filled sun.
struct MenuBarProtectionStatus {
    enum Kind: Hashable {
        case blocked
        case connecting
        case connected
        case degraded
        case unconfirmed
        case standby
    }

    let kind: Kind
    let title: LocalizedStringKey
    let color: Color
    var imageName: String { Self.imageName(for: kind) }

    init(_ appState: AppState) {
        if appState.isDisconnecting {
            kind = .connecting
            title = "Disconnecting…"
            color = TonoBrand.accent
        } else if appState.isConnecting {
            kind = .connecting
            title = LocalizedStringKey(appState.connectionStage.rawValue)
            color = TonoBrand.accent
        } else if appState.isProtectedReconnectScheduled {
            kind = .blocked
            title = "Waiting to retry…"
            color = TonoStatus.blocked
        } else if appState.isProtectionUnconfirmed || appState.isProtectionBlockUnreadable {
            kind = .unconfirmed
            title = "Protection unknown"
            color = TonoStatus.blocked
        } else if appState.protectedReconnectPausedForUserAction,
                  appState.isProtectionBlocked {
            // The pause can outlive a completed release (the third
            // supervisor repair releases, then pauses the unarmed retry).
            // An open host is not Protected Offline (MAC-PAUSED-OPEN-STATUS).
            kind = .blocked
            title = "Protected Offline · retries paused"
            color = TonoStatus.blocked
        } else if appState.isProtectionBlocked {
            kind = .blocked
            title = "Protected Offline"
            color = TonoStatus.blocked
        } else if appState.isProxyDegraded {
            kind = .degraded
            title = "Degraded"
            color = TonoStatus.blocked
        } else if appState.isConnected {
            kind = .connected
            // AI Home protects listed AI only; unmatched traffic goes DIRECT
            // (decision 130), so the whole-host word is not available to it.
            title = appState.sessionProtectionScope == .listedAI ? "AI protected" : "Protected"
            color = TonoStatus.connected
        } else {
            kind = .standby
            title = "Standby"
            color = TonoStatus.neutral
        }
    }

    static func imageName(for kind: Kind) -> String {
        switch kind {
        case .blocked: blockedImage
        case .connecting: connectingImage
        case .connected: connectedImage
        case .degraded: degradedImage
        case .unconfirmed: unconfirmedImage
        case .standby: standbyImage
        }
    }

    /// Broken arch, not the standby arch: MenuBarExtra is monochrome, so
    /// connecting and standby cannot share a glyph.
    private static let connectingImage = "MenuBarStatusConnecting"
    private static let blockedImage = "MenuBarStatusBlocked"
    private static let degradedImage = "MenuBarStatusDegraded"
    private static let connectedImage = "MenuBarStatusConnected"
    /// Open arch with the badge, not degraded's filled sun: no session is making a claim.
    private static let unconfirmedImage = "MenuBarStatusUnconfirmed"
    private static let standbyImage = "MenuBarStatusStandby"
}

/// Status-item label. Shape-only: the image sets are template images, which
/// AppKit tints for light/dark bars and the open-highlight, so
/// palette/foregroundStyle would be flattened.
struct MenuBarStatusItemLabel: View {
    var appState: AppState

    var body: some View {
        let status = MenuBarProtectionStatus(appState)
        Image(status.imageName)
            .renderingMode(.template)
            .id(status.kind)
            .accessibilityLabel(status.title)
    }
}
