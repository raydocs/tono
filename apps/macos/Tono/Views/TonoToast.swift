import SwiftUI

/// App-wide transient confirmations ("Switched to …", "Logs exported"). One
/// toast at a time — a new one replaces the current and resets its timer.
/// UI-layer only: views call `show`, no service layer is touched.
@MainActor @Observable
final class ToastCenter {
    static let shared = ToastCenter()

    struct Toast: Equatable, Identifiable {
        let id = UUID()
        let message: String
        let systemImage: String
    }

    private(set) var current: Toast?
    private var dismissTask: Task<Void, Never>?

    private init() {}

    func show(_ message: String, systemImage: String) {
        dismissTask?.cancel()
        let toast = Toast(message: message, systemImage: systemImage)
        current = toast
        dismissTask = Task {
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled else { return }
            if current?.id == toast.id {
                current = nil
            }
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        dismissTask = nil
        current = nil
    }
}

/// Top-center glass capsule hosting the current toast. Mounted once as an
/// overlay on the window root (TonoApp). Text stays a plain `Text` so
/// VoiceOver announces it.
struct TonoToastHost: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.seaAccent) private var seaAccent
    @SeaAppearancePreference private var seaAppearance
    @SeaDisplayPreferences private var displayPreferences
    private var reduceMotion: Bool { displayPreferences.reduceMotion }

    var body: some View {
        let opaque = displayPreferences.reduceTransparency || displayPreferences.contrast == .increased
        Group {
            if let toast = ToastCenter.shared.current {
                HStack(spacing: 8) {
                    Image(systemName: toast.systemImage)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(seaAppearance ? seaAccent : TonoBrand.accent)
                    Text(toast.message)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(seaAppearance ? SeaTheme.text : .primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .frame(maxWidth: 460)
                .background {
                    if opaque {
                        Capsule()
                            .fill(seaAppearance || colorScheme == .dark ? SeaTheme.opaquePanel : Color(nsColor: .windowBackgroundColor))
                    }
                }
                .overlay {
                    if displayPreferences.contrast == .increased {
                        Capsule()
                            .strokeBorder(
                                SeaTheme.specularBorder(contrast: displayPreferences.contrast, reduceTransparency: displayPreferences.reduceTransparency),
                                lineWidth: 1
                            )
                    }
                }
                .modifier(ToastGlassEffect(enabled: !opaque))
                .shadow(color: opaque ? .clear : .black.opacity(0.12), radius: 16, y: 7)
                .contentShape(Capsule())
                .onTapGesture {
                    ToastCenter.shared.dismiss()
                }
                .padding(.top, 14)
                .id(toast.id)
                .transition(
                    reduceMotion
                        ? .opacity
                        : .move(edge: .top).combined(with: .opacity)
                )
            }
        }
        .animation(
            TonoMotion.easeOut(0.25, reduceMotion: reduceMotion),
            value: ToastCenter.shared.current
        )
        .onChange(of: ToastCenter.shared.current?.id) { _, _ in
            if let message = ToastCenter.shared.current?.message {
                AccessibilityNotification.Announcement(message).post()
            }
        }
    }
}

private struct ToastGlassEffect: ViewModifier {
    let enabled: Bool

    @ViewBuilder func body(content: Content) -> some View {
        if enabled {
            content.glassEffect(.regular, in: Capsule())
        } else {
            content
        }
    }
}

/// Convenience overlay mounting the host; keeps the call site one line.
extension View {
    func tonoToastHost() -> some View {
        overlay(alignment: .top) {
            TonoToastHost()
        }
    }
}

#Preview {
    ZStack {
        MeshGradientBackground()
        Color.clear
            .tonoToastHost()
    }
    .frame(width: 700, height: 400)
    .task {
        ToastCenter.shared.show("Switched to Tokyo · Dawn", systemImage: "checkmark.circle.fill")
    }
}
