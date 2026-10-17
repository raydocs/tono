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
            if model.phase == .signedOut {
                SignInView().transition(.opacity)
            } else {
                HomeView().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: model.phase == .signedOut)
    }
}
