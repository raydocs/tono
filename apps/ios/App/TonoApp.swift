import SwiftUI
import TonoKit

@main
struct TonoApp: App {
    @StateObject private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if CommandLine.arguments.contains("-TonoPreviewCycle") {
            _model = StateObject(wrappedValue: AppModel.previewCycle())
            return
        }
        if let i = CommandLine.arguments.firstIndex(of: "-TonoPreview"), i + 1 < CommandLine.arguments.count,
           let phase = Phase(rawValue: CommandLine.arguments[i + 1]) {
            _model = StateObject(wrappedValue: AppModel.preview(phase))
            return
        }
        #endif
        _model = StateObject(wrappedValue: AppModel())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                .preferredColorScheme(.dark)
                .task { await model.onLaunch() }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .active { Task { await model.onForeground() } }
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ZStack {
            #if DEBUG
            if CommandLine.arguments.contains("-TonoPreviewWidgets") {
                WidgetGallery()
            } else if CommandLine.arguments.contains("-TonoPreviewContrastProbe") {
                ContrastProbe()
            } else {
                content
            }
            #else
            content
            #endif
        }
        .animation(.easeInOut(duration: 0.35), value: model.phase == .signedOut)
        .animation(.easeInOut(duration: 0.35), value: model.showOnboarding)
        .previewBadge()
        .tonoAccessibility()
    }

    @ViewBuilder private var content: some View {
        ZStack {
            if model.showOnboarding {
                OnboardingView().transition(.opacity)
            } else if model.phase == .signedOut {
                SignInView().transition(.opacity)
            } else {
                HomeView().transition(.opacity)
            }
        }
    }
}

extension View {
    /// DEBUG design preview only: every capture says it shows fixture data, not a real account or
    /// tunnel. Compiled out of Release (CI fails a Release binary that contains `-TonoPreview`).
    @ViewBuilder func previewBadge() -> some View {
        #if DEBUG
        // The widget gallery carries the badge in its own top strip, above the cards.
        if PreviewBadge.shown && !CommandLine.arguments.contains("-TonoPreviewWidgets") {
            overlay(alignment: .top) { PreviewBadge().padding(.top, 2) }
        } else {
            self
        }
        #else
        self
        #endif
    }
}

#if DEBUG
/// The yellow "fixtures" badge on every DEBUG preview surface.
struct PreviewBadge: View {
    static var shown: Bool { CommandLine.arguments.contains(where: { $0.hasPrefix("-TonoPreview") }) }

    var body: some View {
        Text(L.isChinese ? "预览 · 夹具 · 无账号/隧道" : "Preview · fixtures · no account/tunnel")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(Color.black)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Color.yellow, in: Capsule())
            .allowsHitTesting(false)
            .accessibilityIdentifier("previewBadge")
    }
}
#endif
