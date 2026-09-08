import SwiftUI
import AppKit

// MARK: - Window Configurator (NSWindow-level safety net)

struct WindowConfigurator: NSViewRepresentable {
    let onVisibilityChange: @MainActor @Sendable (Bool) -> Void

    @MainActor
    final class Coordinator: NSObject {
        let onVisibilityChange: @MainActor @Sendable (Bool) -> Void
        weak var window: NSWindow?

        init(onVisibilityChange: @escaping @MainActor @Sendable (Bool) -> Void) {
            self.onVisibilityChange = onVisibilityChange
        }

        func attach(to window: NSWindow) {
            guard self.window !== window else {
                reportVisibility()
                return
            }
            NotificationCenter.default.removeObserver(self)
            self.window = window
            for name in [
                NSWindow.didChangeOcclusionStateNotification,
                NSWindow.didMiniaturizeNotification,
                NSWindow.didDeminiaturizeNotification,
                NSWindow.willCloseNotification,
            ] {
                NotificationCenter.default.addObserver(
                    self,
                    selector: #selector(windowVisibilityChanged(_:)),
                    name: name,
                    object: window
                )
            }
            reportVisibility()
        }

        @objc private func windowVisibilityChanged(_ notification: Notification) {
            if notification.name == NSWindow.willCloseNotification {
                onVisibilityChange(false)
            } else {
                reportVisibility()
            }
        }

        private func reportVisibility() {
            guard let window else {
                onVisibilityChange(false)
                return
            }
            onVisibilityChange(
                window.isVisible
                    && !window.isMiniaturized
                    && window.occlusionState.contains(.visible)
            )
        }

        deinit {
            NotificationCenter.default.removeObserver(self)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator { visible in
            onVisibilityChange(visible)
        }
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async { [weak view] in
            guard let view, let window = view.window else { return }
            window.minSize = NSSize(width: 860, height: 540)
            window.contentMinSize = NSSize(width: 860, height: 540)
            window.isOpaque = false
            window.backgroundColor = .clear
            context.coordinator.attach(to: window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        if let window = nsView.window {
            context.coordinator.attach(to: window)
        }
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        _ = nsView
        coordinator.onVisibilityChange(false)
        NotificationCenter.default.removeObserver(coordinator)
    }
}
