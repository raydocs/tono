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
    var connectionStage: ConnectionStage = .preparing
    var disconnectionStage: DisconnectionStage = .finishingOperation
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var accentColor: Color {
        if isConnecting || isDisconnecting { return TonoStatus.connecting }
        if isProtectionBlocked { return TonoStatus.blocked }
        return isConnected ? TonoStatus.connected : TonoStatus.standby
    }

    var body: some View {
        Button {
            isConnected.toggle()
        } label: {
            HStack(alignment: .center, spacing: 0) {
                iconWithGlow
                    .frame(width: 60, height: 72)
                textBlock
                    .frame(width: 160)
                Spacer(minLength: 0)
            }
            .frame(width: 240, height: 72)
            .contentShape(Capsule())
        }
        .buttonStyle(ConnectPillPressStyle())
        .glassEffect(
            .regular.tint(pillTint),
            in: Capsule()
        )
        .shadow(
            color: isConnected
                ? TonoStatus.connected.opacity(0.25)
                : Color.black.opacity(colorScheme == .dark ? 0.35 : 0.10),
            radius: 15, y: 5
        )
        // The progress card owns the explicit cancel/restore action. Keeping
        // the unlabeled pill inert during a transition prevents an accidental
        // click from releasing fail-closed protection during an auto-retry.
        .disabled(isConnecting || isDisconnecting)
        .animation(TonoMotion.easeOut(0.22, reduceMotion: reduceMotion), value: isConnected)
        .animation(TonoMotion.easeOut(0.22, reduceMotion: reduceMotion), value: isConnecting)
        .animation(TonoMotion.easeOut(0.22, reduceMotion: reduceMotion), value: isDisconnecting)
    }

    // Glass tint adapts to color scheme
    private var pillTint: Color {
        colorScheme == .dark
            ? .black.opacity(0.55)
            : .white.opacity(0.06)
    }

    // MARK: - Icon with Glow

    private var iconWithGlow: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            accentColor.opacity(isConnected || isConnecting || isDisconnecting ? 0.72 : 0.45),
                            accentColor.opacity(isConnected || isConnecting || isDisconnecting ? 0.48 : 0.28),
                            accentColor.opacity(isConnected || isConnecting || isDisconnecting ? 0.18 : 0.10),
                            .clear,
                        ],
                        center: .center,
                        startRadius: 12,
                        endRadius: 44
                    )
                )
                .frame(width: 96, height: 96)
                .opacity(isConnected || isConnecting || isDisconnecting ? 0.78 : 0.48)
                .scaleEffect(
                    reduceMotion
                        ? 1
                        : (isConnected || isConnecting || isDisconnecting ? 1.08 : 0.96)
                )
                .accessibilityHidden(true)

            // Clash logo
            LiquidClashLogo(isConnected: isConnected && !isDisconnecting)
                .frame(width: 52, height: 52)
                .shadow(
                    color: isConnected ? accentColor.opacity(0.4) : .clear,
                    radius: 8
                )
        }
        .frame(width: 70, height: 70)
    }

    // MARK: - Text Block

    private var statusText: LocalizedStringKey {
        if isConnecting { return "Connecting…" }
        if isDisconnecting { return "Disconnecting…" }
        if isProtectionBlocked { return "Protected Offline" }
        return isConnected ? "Connected" : "Not Connected"
    }

    private var statusSubtext: LocalizedStringKey {
        if isConnecting { return LocalizedStringKey(connectionStage.rawValue) }
        if isDisconnecting { return LocalizedStringKey(disconnectionStage.rawValue) }
        if isProtectionBlocked { return "Tap to restore internet" }
        return isConnected ? "Tap to disconnect" : "Tap to connect"
    }

    private var statusColor: Color {
        if isConnecting || isDisconnecting { return TonoStatus.connecting }
        if isProtectionBlocked { return TonoStatus.blocked }
        return isConnected ? TonoStatus.connected : Color.primary
    }

    private var textBlock: some View {
        VStack(spacing: 3) {
            Text(statusText)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(statusColor)

            HStack(spacing: 6) {
                if isConnecting || isDisconnecting {
                    ProgressView()
                        .controlSize(.mini)
                        .scaleEffect(0.7)
                } else {
                    Circle()
                        .fill(accentColor)
                        .frame(width: 6, height: 6)
                        .shadow(color: accentColor.opacity(0.5), radius: 3)
                }

                Text(statusSubtext)
                    .font(.system(size: 11, weight: .medium))
                    .kerning(1.1)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
            }
        }
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
