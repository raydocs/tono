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
    private var installPreparationFailed = false

    func updater(
        _ updater: SPUUpdater,
        shouldPostponeRelaunchForUpdate item: SUAppcastItem,
        untilInvokingBlock installHandler: @escaping () -> Void
    ) -> Bool {
        guard !installPrepared else { return false }
        Task { @MainActor in
            let version = item.displayVersionString
            await self.prepareInstallation(prepare: {
                guard let appState = self.appState else {
                    throw CoreRuntimeError.startFailed("Update preparation requires the application state.")
                }
                let journal = try await appState.prepareForSoftwareUpdate(nextVersion: version)
                let recorded = journal.advancing(to: .installStarted)
                do {
                    try UpdateHandoffStore.write(recorded)
                } catch {
                    try? UpdateHandoffStore.write(journal.advancing(
                        to: .failed,
                        errorCode: "TONO_UPDATE_PREPARATION_FAILED",
                        errorStage: "installEntry"
                    ))
                    throw error
                }
            }, installHandler: installHandler)
        }
        return true
    }

    func prepareInstallation(
        prepare: () async throws -> Void,
        installHandler: () -> Void
    ) async {
        do {
            try await prepare()
            installPrepared = true
        } catch {
            installPreparationFailed = true
            appState?.updateIncomplete = true
            appState?.errorMessage = UpdateHandoffStore.incompleteUpdateCopy
                + " " + error.localizedDescription
        }
        // Sparkle 2.9.6 rechecks updaterShouldRelaunchApplication *before*
        // continuing installation. On failure resume only to reach that veto;
        // keeping the block forever would strand the update cycle and Retry.
        installHandler()
    }

    func updaterShouldRelaunchApplication(_ updater: SPUUpdater) -> Bool {
        !installPreparationFailed
    }

    func updater(
        _ updater: SPUUpdater,
        didFinishUpdateCycleFor updateCheck: SPUUpdateCheck,
        error: Error?
    ) {
        installPrepared = false
        installPreparationFailed = false
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
