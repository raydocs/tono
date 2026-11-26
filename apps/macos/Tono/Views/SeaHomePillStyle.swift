import SwiftUI

/// Home-only action treatment; page control unification belongs to polish B.
struct SeaHomePillStyle: ButtonStyle {
    let primary: Bool
    @SeaDisplayPreferences private var displayPreferences
    private var reduceMotion: Bool { displayPreferences.reduceMotion }
    private var reduceTransparency: Bool { displayPreferences.reduceTransparency }
    private var contrast: ColorSchemeContrast { displayPreferences.contrast }
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        SeaHomePill(configuration: configuration, primary: primary,
            reduceMotion: reduceMotion, opaque: reduceTransparency || contrast == .increased, enabled: enabled)
    }
}

private struct SeaHomePill: View {
    let configuration: ButtonStyleConfiguration
    let primary: Bool
    let reduceMotion: Bool
    let opaque: Bool
    let enabled: Bool
    @State private var hovered = false

    var body: some View {
        let sheenOpacity: Double = configuration.isPressed ? 0.16 : (hovered && enabled ? 0.08 : 0)
        configuration.label
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(primary ? SeaTheme.ink : SeaTheme.text)
            .padding(.horizontal, 22)
            .frame(minWidth: 120, minHeight: 48, maxHeight: 48)
            .background {
                if primary {
                    Capsule(style: .circular)
                        .fill(SeaTheme.primaryGradient)
                        .overlay {
                            Capsule(style: .circular).fill(.white.opacity(sheenOpacity))
                        }
                } else if opaque {
                    Capsule(style: .circular)
                        .fill(hovered && enabled ? Color(hex: "352725") : Color(hex: "2B201E"))
                } else {
                    Capsule(style: .circular).fill(LinearGradient(
                        colors: [Color(hex: "28100E").opacity(hovered && enabled ? 0.26 : 0.34),
                                 Color(hex: "28100E").opacity(hovered && enabled ? 0.38 : 0.46)],
                        startPoint: .top, endPoint: .bottom))
                        .background(.ultraThinMaterial, in: Capsule(style: .circular))
                        .overlay {
                            Capsule(style: .circular).fill(.white.opacity(sheenOpacity))
                        }
                }
            }
            .overlay {
                Capsule(style: .circular).strokeBorder(LinearGradient(
                    colors: [Color(hex: "FFEBD2").opacity(opaque ? 0.55 : (hovered && enabled ? 0.42 : 0.30)),
                             .white.opacity(opaque ? 0.18 : 0.06)],
                    startPoint: .top, endPoint: .bottom), lineWidth: opaque ? 1 : 0.85)
            }
            .shadow(
                color: opaque ? .clear : (primary ? SeaTheme.warm.opacity(hovered && enabled ? 0.26 : 0.16) : .black.opacity(0.24)),
                radius: primary ? (hovered && enabled ? 14 : 10) : 10,
                y: 4
            )
            .contentShape(Capsule(style: .circular))
            .opacity(enabled ? 1 : 0.45)
            .scaleEffect(SeaHomePresentation.pressScale(pressed: configuration.isPressed, reduceMotion: reduceMotion))
            .animation(TonoMotion.tactileSpring(reduceMotion: reduceMotion), value: configuration.isPressed)
            .animation(TonoMotion.hover(reduceMotion: reduceMotion), value: hovered)
            .onHover { hovered = enabled ? $0 : false }
    }
}

struct SeaHomeActionShortcut: ViewModifier {
    let ownsShortcut: Bool
    @ViewBuilder func body(content: Content) -> some View {
        if ownsShortcut {
            content.modifier(ConnectPillKeyboardShortcut(isConnecting: false, isDisconnecting: false))
        } else { content }
    }
}

/// The existing selected-exit timer samples every 120 s. Untimed catalog/cache
/// numbers are not fresh readings and never become a Home measurement.
enum SeaHomePresentation {
    static func pressScale(pressed: Bool, reduceMotion: Bool) -> CGFloat {
        pressed && !reduceMotion ? 0.97 : 1
    }

    static func freshExitDelay(_ sample: (node: String, ms: Int, at: Date)?,
                               for name: String, failed: Bool, now: Date = Date()) -> Int? {
        guard !failed, let sample, sample.ms > 0,
              ConfigParser.extractFlag(from: sample.node).cleanName == ConfigParser.extractFlag(from: name).cleanName,
              (0..<120).contains(now.timeIntervalSince(sample.at)) else { return nil }
        return sample.ms
    }
}

/// A single presentation expiry, not a new measurement or periodic redraw.
/// SwiftUI cancels it when this reading leaves Home or the sample is replaced.
struct SeaHomeLatencyReading: View {
    let sample: (node: String, ms: Int, at: Date)?
    let name: String
    let failed: Bool
    @State private var checkedAt = Date()

    var body: some View {
        Group {
            if let latency = SeaHomePresentation.freshExitDelay(sample, for: name,
                failed: failed, now: max(checkedAt, Date())) {
                Text("\(latency) ms").foregroundStyle(SeaTheme.muted).monospacedDigit()
            }
        }
        .task(id: sample?.at) {
            checkedAt = Date()
            guard let sample else { return }
            let delay = sample.at.addingTimeInterval(120).timeIntervalSinceNow
            guard delay > 0 else { return }
            do { try await Task.sleep(for: .seconds(delay)) }
            catch { return }
            guard !Task.isCancelled else { return }
            checkedAt = Date()
        }
    }
}
