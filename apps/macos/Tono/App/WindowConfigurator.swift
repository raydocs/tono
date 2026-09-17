import SwiftUI
import AppKit

// MARK: - Window Configurator (NSWindow-level safety net)

private final class WindowConfiguratorView: NSView {
    override func hitTest(_ point: NSPoint) -> NSView? {
        nil
    }
}

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
        let view = WindowConfiguratorView()
        DispatchQueue.main.async { [weak view] in
            guard let view, let window = view.window else { return }
            let minSize = NSSize(width: 860, height: 540)
            let maxSize = NSSize(width: 1280, height: 720)
            window.minSize = minSize
            window.contentMinSize = minSize
            window.maxSize = maxSize
            window.contentMaxSize = maxSize

            if window.frame.height > maxSize.height || window.frame.width > maxSize.width {
                let defaultSize = NSSize(width: 920, height: 600)
                let screen = window.screen ?? NSScreen.main
                let visibleFrame = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
                let origin = NSPoint(
                    x: visibleFrame.midX - defaultSize.width / 2,
                    y: visibleFrame.midY - defaultSize.height / 2
                )
                window.setFrame(NSRect(origin: origin, size: defaultSize), display: true, animate: false)
            }

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
