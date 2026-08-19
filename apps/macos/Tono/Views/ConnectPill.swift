import SwiftUI

/// Press feedback for the connection pill: a quick 0.98 squeeze. The pill is
/// disabled during connecting/disconnecting, so the press state only ever
/// appears when a tap is actionable. Reduce Motion skips the scale entirely.
private struct ConnectPillPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(
                TonoMotion.easeOut(0.1, reduceMotion: reduceMotion),
                value: configuration.isPressed
            )
    }
}

struct ConnectPill: View {
    @Binding var isConnected: Bool
    var isConnecting: Bool = false
    var isDisconnecting: Bool = false
    var isProtectionBlocked: Bool = false
    var isRecovering: Bool = false
    var connectionStage: ConnectionStage = .preparing
    var disconnectionStage: DisconnectionStage = .finishingOperation
    /// Wire name of the selected exit, for the context line under the state.
    var nodeName: String? = nil
    var nodeLatency: Int = 0
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var accentColor: Color {
        if isConnecting || isDisconnecting || isRecovering { return TonoStatus.connecting }
        if isProtectionBlocked { return TonoStatus.blocked }
        return isConnected ? TonoStatus.connected : TonoStatus.standby
    }

    private var isBusy: Bool { isConnecting || isDisconnecting || isRecovering }

    var body: some View {
        Button {
            isConnected.toggle()
        } label: {
            HStack(alignment: .center, spacing: 14) {
                // The real product mark, no plate: gray at rest, full color
                // once the tunnel is up.
                Image("TonoMark")
                    .resizable()
                    .interpolation(.high)
                    .scaledToFit()
                    .frame(width: 40, height: 40)
                    .saturation(isConnected || isBusy ? 1 : 0)
                    .opacity(isConnected || isBusy ? 1 : 0.72)
                    .shadow(
                        color: isConnected ? TonoStatus.connected.opacity(0.55) : .clear,
                        radius: 10
                    )
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(statusText)
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(statusColor)
                        .lineLimit(1)
                    Text(contextText)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }

                Spacer(minLength: 10)

                // Power affordance: the whole pill is the button; this is the
                // visual anchor that says so.
                ZStack {
                    Circle()
                        .fill(
                            isConnected
                                ? TonoStatus.connected.opacity(0.15)
                                : .white.opacity(colorScheme == .dark ? 0.07 : 0.6)
                        )
                        .overlay {
                            Circle().strokeBorder(
                                isConnected
                                    ? TonoStatus.connected.opacity(0.4)
                                    : .white.opacity(colorScheme == .dark ? 0.14 : 0.8),
                                lineWidth: 0.8
                            )
                        }
                    if isBusy {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.8)
                    } else {
                        Image(systemName: "power")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(isConnected ? TonoStatus.connected : .secondary)
                    }
                }
                .frame(width: 36, height: 36)
                .accessibilityHidden(true)
            }
            .padding(.leading, 20)
            .padding(.trailing, 18)
            .frame(width: 292, height: 76)
            .contentShape(Capsule())
        }
        .buttonStyle(ConnectPillPressStyle())
        .background(
            .white.opacity(colorScheme == .dark ? 0.05 : 0.5),
            in: Capsule()
        )
        .overlay {
            Capsule().strokeBorder(
                isConnected
                    ? TonoStatus.connected.opacity(0.4)
                    : .white.opacity(colorScheme == .dark ? 0.10 : 0.75),
                lineWidth: isConnected ? 1 : 0.7
            )
        }
        .glassEffect(.regular, in: Capsule())
        .shadow(
            color: isConnected
                ? TonoStatus.connected.opacity(0.3)
                : Color.black.opacity(colorScheme == .dark ? 0.4 : 0.10),
            radius: isConnected ? 22 : 15, y: 6
        )
        // The progress card owns the explicit cancel/restore action. Keeping
        // the unlabeled pill inert during a transition prevents an accidental
        // click from releasing fail-closed protection during an auto-retry.
        .disabled(isConnecting || isDisconnecting)
        .animation(TonoMotion.easeOut(0.25, reduceMotion: reduceMotion), value: isConnected)
        .animation(TonoMotion.easeOut(0.25, reduceMotion: reduceMotion), value: isConnecting)
        .animation(TonoMotion.easeOut(0.25, reduceMotion: reduceMotion), value: isDisconnecting)
    }

    // MARK: - Copy

    private var statusText: LocalizedStringKey {
        if isConnecting { return "Connecting…" }
        if isDisconnecting { return "Disconnecting…" }
        if isRecovering { return "正在恢复受保护连接" }
        if isProtectionBlocked { return "Protected Offline" }
        return isConnected ? "Connected" : "Not Connected"
    }

    private var nodeDisplay: String? {
        guard let nodeName, !nodeName.isEmpty else { return nil }
        let clean = ProxyNode.displayName(
            for: ConfigParser.extractFlag(from: nodeName).cleanName
        )
        return nodeCityTitle(clean)
    }

    private var contextText: String {
        if isConnecting { return String(localized: String.LocalizationValue(connectionStage.rawValue)) }
        if isDisconnecting { return String(localized: String.LocalizationValue(disconnectionStage.rawValue)) }
        if isRecovering { return String(localized: "正在恢复受保护连接") }
        if isProtectionBlocked { return String(localized: "Tap to restore internet") }
        if isConnected {
            if let nodeDisplay, nodeLatency > 0 {
                return "\(nodeDisplay) — \(nodeLatency) ms"
            }
            if let nodeDisplay { return nodeDisplay }
            return String(localized: "Tap to disconnect")
        }
        if let nodeDisplay {
            return String(localized: "Tap to connect via \(nodeDisplay)")
        }
        return String(localized: "Tap to connect")
    }

    private var statusColor: Color {
        if isConnecting || isDisconnecting { return TonoStatus.connecting }
        if isProtectionBlocked { return TonoStatus.blocked }
        return isConnected ? TonoStatus.connected : Color.primary
    }
}

// MARK: - Previews

#Preview("Dark - Disconnected") {
    @Previewable @State var connected = false

    ZStack {
        MeshGradientBackground()
        ConnectPill(isConnected: $connected)
    }
    .frame(width: 400, height: 200)
    .preferredColorScheme(.dark)
}

#Preview("Dark - Connected") {
    @Previewable @State var connected = true

    ZStack {
        MeshGradientBackground()
        ConnectPill(isConnected: $connected)
    }
    .frame(width: 400, height: 200)
    .preferredColorScheme(.dark)
}

#Preview("Light - Disconnected") {
    @Previewable @State var connected = false

    ZStack {
        MeshGradientBackground()
        ConnectPill(isConnected: $connected)
    }
    .frame(width: 400, height: 200)
    .preferredColorScheme(.light)
}

#Preview("Light - Connected") {
    @Previewable @State var connected = true

    ZStack {
        MeshGradientBackground()
        ConnectPill(isConnected: $connected)
    }
    .frame(width: 400, height: 200)
    .preferredColorScheme(.light)
}
