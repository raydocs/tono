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
                .task(id: scenePhase == .active && [.connecting, .protected, .recovering].contains(model.state) && !model.isPreview) {
                    guard scenePhase == .active, !model.isPreview else { return }
                    // Revalidate immediately after foregrounding, before waiting.
                    while !Task.isCancelled && [.connecting, .protected, .recovering].contains(model.state) {
                        model.expireProtectionReceipt()
                        do { try await Task.sleep(for: .seconds(1)) } catch { return }
                    }
                }
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
