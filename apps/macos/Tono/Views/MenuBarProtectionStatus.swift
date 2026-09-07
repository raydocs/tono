import SwiftUI

/// One derivation for the menu-bar extra header and the status-item symbol.
/// Five shapes carry state at a glance: MenuBarExtra renders template images,
/// so color is not visible in the extra itself and must not be relied on there.
struct MenuBarProtectionStatus {
    enum Kind: Hashable {
        case blocked
        case connecting
        case connected
        case degraded
        case standby
    }

    let kind: Kind
    let title: LocalizedStringKey
    let color: Color
    let symbolName: String

    init(_ appState: AppState) {
        if appState.isDisconnecting {
            kind = .connecting
            title = "Disconnecting…"
            color = TonoStatus.connecting
            symbolName = Self.connectingSymbol
        } else if appState.isConnecting {
            kind = .connecting
            title = LocalizedStringKey(appState.connectionStage.rawValue)
            color = TonoStatus.connecting
            symbolName = Self.connectingSymbol
        } else if appState.isProtectedReconnectScheduled {
            kind = .blocked
            title = "Waiting to retry…"
            color = TonoStatus.blocked
            symbolName = Self.blockedSymbol
        } else if appState.protectedReconnectPausedForUserAction {
            kind = .blocked
            title = "Protected Offline · retries paused"
            color = TonoStatus.blocked
            symbolName = Self.blockedSymbol
        } else if appState.isProtectionBlocked {
            kind = .blocked
            title = "Protected Offline"
            color = TonoStatus.blocked
            symbolName = Self.blockedSymbol
        } else if appState.isProxyDegraded {
            kind = .degraded
            title = "Degraded"
            color = TonoStatus.blocked
            symbolName = Self.degradedSymbol
        } else if appState.isConnected {
            kind = .connected
            title = "Protected"
            color = TonoStatus.connected
            symbolName = Self.connectedSymbol
        } else {
            kind = .standby
            title = "Standby"
            color = TonoStatus.neutral
            symbolName = Self.standbySymbol
        }
    }

    /// Dotted, not the standby half-shield: MenuBarExtra is monochrome, so
    /// connecting and standby cannot share a glyph.
    private static let connectingSymbol = "shield.dotted"
    private static let blockedSymbol = "shield.slash.fill"
    private static let degradedSymbol = "exclamationmark.shield.fill"
    private static let connectedSymbol = "checkmark.shield.fill"
    private static let standbySymbol = "shield.lefthalf.filled"
}

/// Status-item label. Shape-only: AppKit templates the image for light/dark
/// bars and the open-highlight, so palette/foregroundStyle would be flattened.
struct MenuBarStatusItemLabel: View {
    var appState: AppState

    var body: some View {
        let status = MenuBarProtectionStatus(appState)
        Image(systemName: status.symbolName)
            .id(status.kind)
            .accessibilityLabel(status.title)
    }
}
