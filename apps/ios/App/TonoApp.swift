import SwiftUI

@main
struct TonoApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView(model: model)
                .tint(.teal)
                .task { await model.restore() }
                .task(id: scenePhase) {
                    guard scenePhase == .active else { return }
                    // Foreground only for this draft. No claim of extension/background upload.
                    while !Task.isCancelled {
                        do { try await Task.sleep(for: .seconds(1200)) } catch { return }
                        guard !Task.isCancelled else { return }
                        await model.uploadDiagnostics(userInitiated: false)
                    }
                }
        }
    }
}
