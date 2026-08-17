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
}

/// Top-center glass capsule hosting the current toast. Mounted once as an
/// overlay on the window root (LiquidClashApp). Text stays a plain `Text` so
/// VoiceOver announces it.
struct TonoToastHost: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            if let toast = ToastCenter.shared.current {
                HStack(spacing: 8) {
                    Image(systemName: toast.systemImage)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(TonoBrand.accent)
                    Text(toast.message)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    .white.opacity(colorScheme == .dark ? 0.10 : 0.5),
                    in: Capsule()
                )
                .overlay {
                    Capsule()
                        .strokeBorder(
                            .white.opacity(colorScheme == .dark ? 0.14 : 0.6),
                            lineWidth: 0.5
                        )
                }
                .glassEffect(.regular, in: Capsule())
                .shadow(color: .black.opacity(0.12), radius: 16, y: 7)
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
