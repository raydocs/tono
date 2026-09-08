import SwiftUI
import Sparkle
import Combine
import AppKit

/// Owns Sparkle's single long-lived updater. Release builds start it only from
/// /Applications, so a read-only DMG launch cannot perform network or update
/// work before the existing installation guard terminates the app.
@MainActor
final class AppUpdater: ObservableObject {
    @Published private(set) var canCheckForUpdates = false
    private let updaterController: SPUStandardUpdaterController?
    private let sparkleDelegate: TonoSparkleDelegate?

    init(enabled: Bool) {
        guard enabled else {
            updaterController = nil
            sparkleDelegate = nil
            return
        }

        let delegate = TonoSparkleDelegate()
        self.sparkleDelegate = delegate
        let controller = SPUStandardUpdaterController(
            startingUpdater: true,
            updaterDelegate: delegate,
            userDriverDelegate: nil
        )
        updaterController = controller
        controller.updater.publisher(for: \.canCheckForUpdates)
            .assign(to: &$canCheckForUpdates)
    }

    func attach(appState: AppState) {
        sparkleDelegate?.appState = appState
    }

    func checkForUpdates() {
        updaterController?.updater.checkForUpdates()
    }
}

@MainActor
final class TonoSparkleDelegate: NSObject, SPUUpdaterDelegate {
    weak var appState: AppState?
    private var installPrepared = false

    func updater(
        _ updater: SPUUpdater,
        shouldPostponeRelaunchForUpdate item: SUAppcastItem,
        untilInvokingBlock installHandler: @escaping () -> Void
    ) -> Bool {
        guard !installPrepared else { return false }
        Task { @MainActor in
            let version = item.displayVersionString
            if let appState {
                let journal = await appState.prepareForSoftwareUpdate(nextVersion: version)
                await appState.finishPendingDisconnect()
                if KillSwitchService.isArmed {
                    appState.markProtectedUpdateHandoff(journal)
                }
            }
            if var recorded = UpdateHandoffStore.load() {
                recorded = recorded.advancing(to: .installStarted)
                try? UpdateHandoffStore.write(recorded)
            }
            self.installPrepared = true
            installHandler()
        }
        return true
    }
}

struct CheckForUpdatesView: View {
    @ObservedObject var updater: AppUpdater

    var body: some View {
        Button("Check for Updates") {
            updater.checkForUpdates()
        }
        .disabled(!updater.canCheckForUpdates)
    }
}
