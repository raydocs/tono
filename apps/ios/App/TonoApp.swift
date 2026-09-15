import SwiftUI

@main
struct TonoApp: App {
    @State private var model: AppModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["TONO_ACCOUNT_FIXTURE"] == "malformed-session" {
            _model = State(initialValue: AccountRecoveryFixture.makeModel())
            return
        }
        #endif
        _model = State(initialValue: AppModel())
    }

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
